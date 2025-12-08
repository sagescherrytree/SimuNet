import { Node } from "./Node";
import { GeometryData, removeGeometry } from "../geometry/geometry";
import { IGeometryModifier } from "../interfaces/NodeCapabilities";
import { GPUContext } from "../../webgpu/GPUContext";
// Import recompute normals compute shader.
import copyToPointsComputeShader from '../../webgpu/shaders/copyToPoints.cs.wgsl';
// Wireframe update compute shader.
import mergeWireframeComputeShader from '../../webgpu/shaders/wireframe.cs.wgsl';


export class CopyToPointsNode extends Node implements IGeometryModifier {
    public inputGeometries?: GeometryData[];
    private numInputs = 2;

    cpyToPtsUniformBuffer?: GPUBuffer;

    vertexCountSrc = 0;
    vertexCountTgt = 0;
    indexCountSrc = 0;
    stride = 32;

    cpyToPtsComputeBindGroupLayout: GPUBindGroupLayout;
    cpyToPtsComputeBindGroup: GPUBindGroup;
    cpyToPtsComputePipeline: GPUComputePipeline;

    // For wireframe buffer.
    mergeWireframeUniformBuffer?: GPUBuffer;

    mergeWireframePipeline: GPUComputePipeline;
    mergeWireframeBindGroupLayout: GPUBindGroupLayout;
    mergeWireframeBindGroup: GPUBindGroup;

    // Bounding box buffer.
    // Referebce calculateBounds from geometry node to determine how each bounding box is made.
    boundingBoxBuffer?: GPUBuffer;

    // Corresponding geometry IDs.
    geomIDBuffer?: GPUBuffer; // For keeping track of each instantiated geometry.

    workgroupSize = 64;

    constructor() {
        super("CopyToPoints");

        this.ioBehavior.addMultipleInputs(2);
        this.ioBehavior.addGeometryOutput();
        this.inputGeometries = [];

        const onChange = () => {
            // Don't need check I think since checking within applyModificationMultiple: if (this.inputGeometries) {
            this.applyModificationMultiple(this.inputGeometries);
            this.updateBehavior.triggerUpdate();
        };
    }

    setInputGeometry(geometry: GeometryData, index: number = 0) {
        this.inputGeometries[index] = geometry;
        this.applyModificationMultiple(this.inputGeometries);
    }

    // setInputGeometryMult(geometry1: GeometryData, geometry2: GeometryData) {
    //     this.inputGeometry = geometry1;
    //     this.inputGeometry2 = geometry2;
    //     this.applyModificationMultiple(this.inputGeometries);
    // }

    applyModificationMultiple(inputs: GeometryData[]): GeometryData | undefined {

        for (let i = 0; i < this.numInputs; ++i) {
            if (!inputs[i]) {
                return;
            }
        }

        const src = inputs[0]; // Source (geom to be copied)
        const tgt = inputs[1]; // Target (points to be copied to)

        if (!src.vertexBuffer || !src.indexBuffer || !tgt.vertexBuffer) {
            console.warn("CopyToPointsNode: missing buffers!");
            return;
        }

        // TODO: change logic for accounting for multiple vertex buffers.
        this.vertexCountSrc = src.vertexBuffer!.size / this.stride;
        this.indexCountSrc = src.indexBuffer!.size / 4;
        this.vertexCountTgt = tgt.vertexBuffer!.size / this.stride;

        // Should we get stuffs from pointAttribBuffer for tgt input?
        const pointAttributeBuffer = tgt.pointAttributeBuffer!;

        // GPU stuffs.
        const gpu = GPUContext.getInstance();

        if (this.vertexCountSrc === 0 || this.indexCountSrc === 0 || this.vertexCountTgt === 0) {
            console.warn("CopyToPointsNode: zero-sized input(s)");
            return;
        }

        // Compute output sizes (duplicating source per point).
        const outVertexCount = this.vertexCountSrc * this.vertexCountTgt;
        const outIndexCount = this.indexCountSrc * this.vertexCountTgt;

        const outVertexSize = outVertexCount * this.stride;
        const outIndexSize = outIndexCount * 4;

        // Output buffer for transformed vertices.
        // This outputVertexBuffer should hold all vertices of the geometries that are copied to points.
        const outputVertexBuffer = gpu.device.createBuffer({
            size: outVertexSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC,
        });

        // Output buffer for new indices.
        // This outputVertexBuffer should hold newly calculated indices of the geometries that are copied to points.
        const outputIndexBuffer = gpu.device.createBuffer({
            size: outIndexSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDEX | GPUBufferUsage.COPY_SRC,
        });

        // As a second pass, call wireframe setup.
        const triangleCount = outIndexCount / 3;
        const wireframeSize = triangleCount * 6 * 4;
        const outputWireframeBuffer = gpu.device.createBuffer({
            size: wireframeSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDEX | GPUBufferUsage.COPY_SRC,
        });

        // Read in the boundingBox from src geometry and for targetPoints total count, add bounding box inst to bounding box buffer.

        // TODO: Reinstantiate compute pipelines for copy to points.
        // Need vertexBuffers for both objects.
        // TODO: Update wireframe buffers for CpyToPts logic.
        this.updateUniformBuffer();
        this.setupComputePipeline(src.vertexBuffer!, src.indexBuffer!, tgt.vertexBuffer!, pointAttributeBuffer, outputVertexBuffer, outputIndexBuffer, this.cpyToPtsUniformBuffer);
        this.SetupWireframe(outputIndexBuffer, outputWireframeBuffer, triangleCount);

        const instanceCount = this.vertexCountTgt;

        this.generateBoundingBuffersAsync(src, tgt, instanceCount, this.stride, tgt.pointAttributeBuffer)
            .then(() => {
                // attach bounding buffers to geometry once created
                if (this.geometry) {
                    this.geometry.boundingBoxBuffer = this.boundingBoxBuffer;
                    this.geometry.geomIDBuffer = this.geomIDBuffer;
                    // trigger update if needed (so renderer picks it up)
                    this.updateBehavior.triggerUpdate();
                }
            })
            .catch((e) => console.error("Failed generating bounding buffers:", e));

        // Invoke compute pass.
        const encoder = gpu.device.createCommandEncoder();
        let pass = encoder.beginComputePass();
        pass.setPipeline(this.cpyToPtsComputePipeline);
        pass.setBindGroup(0, this.cpyToPtsComputeBindGroup);

        // operating per triangle; so vertexCount/3s
        const workgroups = Math.ceil(this.vertexCountTgt / 3 / this.workgroupSize);
        pass.dispatchWorkgroups(workgroups);

        pass.end();

        const wfWorkgroups = Math.ceil(triangleCount / this.workgroupSize);
        pass = encoder.beginComputePass();
        pass.setPipeline(this.mergeWireframePipeline);
        pass.setBindGroup(0, this.mergeWireframeBindGroup);
        pass.dispatchWorkgroups(wfWorkgroups);
        pass.end();

        gpu.device.queue.submit([encoder.finish()]);

        this.geometry = {
            vertexBuffer: outputVertexBuffer,
            indexBuffer: outputIndexBuffer,
            wireframeIndexBuffer: outputWireframeBuffer, // TODO: Update wireframe buffer for copy to points.
            id: this.id,
            sourceId: src.sourceId ?? src.id,
            materialBuffer: src.materialBuffer
        };

        return this.geometry;
    }

    // Create uniform buffer with counts and stride (4 x u32 => 16 bytes).
    // Layout: [this.vertexCountSrc, this.indexCountSrc, this.vertexCountTgt, stride].
    updateUniformBuffer() {
        const gpu = GPUContext.getInstance();

        // strength, scale, seed, padding
        const data = new Uint32Array([this.vertexCountSrc, this.indexCountSrc, this.vertexCountTgt, this.stride]);

        if (!this.cpyToPtsUniformBuffer) {
            this.cpyToPtsUniformBuffer = gpu.device.createBuffer({
                size: data.byteLength,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
        }

        gpu.device.queue.writeBuffer(this.cpyToPtsUniformBuffer, 0, data);
    }

    // Pass in buffers for input vertices.
    setupComputePipeline(srcVertexBuffer: GPUBuffer, srcIndexBuffer: GPUBuffer, tgtVertexBuffer: GPUBuffer, pointAttributeBuffer: GPUBuffer,
        outputVertexBuffer: GPUBuffer, outputIndexBuffer: GPUBuffer, cpyToPtsUniBuffer: GPUBuffer) {
        const gpu = GPUContext.getInstance();

        this.cpyToPtsComputeBindGroupLayout = gpu.device.createBindGroupLayout({
            label: "copy to points compute BGL",
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // src vertices
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // src indices
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // target vertices
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // point attribute buffer from attrib random node, if exists.
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // out vertices
                { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // out indices
                { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } }, // counts
            ]
        });

        let shaderModule = gpu.device.createShaderModule({
            label: "copy to points compute shader",
            code: copyToPointsComputeShader,
        });


        const pipelineLayout = gpu.device.createPipelineLayout({
            label: "copy to points compute layout",
            bindGroupLayouts: [this.cpyToPtsComputeBindGroupLayout]
        });

        this.cpyToPtsComputePipeline = gpu.device.createComputePipeline({
            label: "copy to points compute pipeline",
            layout: pipelineLayout,
            compute: { module: shaderModule, entryPoint: "main" },
        });

        this.cpyToPtsComputeBindGroup = gpu.device.createBindGroup({
            layout: this.cpyToPtsComputeBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: srcVertexBuffer } },
                { binding: 1, resource: { buffer: srcIndexBuffer } },
                { binding: 2, resource: { buffer: tgtVertexBuffer } },
                { binding: 3, resource: { buffer: pointAttributeBuffer } },
                { binding: 4, resource: { buffer: outputVertexBuffer } },
                { binding: 5, resource: { buffer: outputIndexBuffer } },
                { binding: 6, resource: { buffer: cpyToPtsUniBuffer } },
            ]
        });

        console.log("CopyToPointsNode: compute shader loaded");
        console.log("CopyToPointsNode: pipeline created:", this.cpyToPtsComputePipeline);
        console.log("CopyToPointsNode: bind group:", this.cpyToPtsComputeBindGroup);
    }

    // Wireframe merge CPU setup.
    SetupWireframe(outputIndexBuffer: GPUBuffer, outputWireframeBuffer: GPUBuffer, triangleCount: number) {
        const gpu = GPUContext.getInstance();
        const wireframeUniformData = new Uint32Array([triangleCount]);

        if (!this.mergeWireframeUniformBuffer) {
            this.mergeWireframeUniformBuffer = gpu.device.createBuffer({
                size: wireframeUniformData.byteLength,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
        }
        gpu.device.queue.writeBuffer(this.mergeWireframeUniformBuffer, 0, wireframeUniformData);

        // Only create pipeline & bind group
        if (!this.mergeWireframePipeline) {
            this.mergeWireframeBindGroupLayout = gpu.device.createBindGroupLayout({
                label: "merge wireframe compute BGL",
                entries: [
                    { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
                    { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
                    { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
                ]
            });

            const wireframeShaderModule = gpu.device.createShaderModule({
                label: "merge wireframe compute shader",
                code: mergeWireframeComputeShader,
            });

            const pipelineLayout = gpu.device.createPipelineLayout({
                label: "merge wireframe compute layout",
                bindGroupLayouts: [this.mergeWireframeBindGroupLayout],
            });

            this.mergeWireframePipeline = gpu.device.createComputePipeline({
                layout: pipelineLayout,
                compute: { module: wireframeShaderModule, entryPoint: "main" },
            });
        }

        // Always recreate bind group for new buffers
        this.mergeWireframeBindGroup = gpu.device.createBindGroup({
            layout: this.mergeWireframeBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: outputIndexBuffer } },
                { binding: 1, resource: { buffer: outputWireframeBuffer } },
                { binding: 2, resource: { buffer: this.mergeWireframeUniformBuffer } },
            ]
        });
    }

    // Readback buffer for boundingBoxGPU.
    async generateBoundingBuffersAsync(
        src: GeometryData,
        tgt: GeometryData,
        instanceCount: number,
        vertexStrideBytes: number,
        pointAttributeBuffer?: GPUBuffer
    ) {
        const gpu = GPUContext.getInstance();

        // Read back target vertex pos from GPU.
        const readbackSize = instanceCount * vertexStrideBytes;
        // Buffer containing information we read back.
        const readBuffer = gpu.device.createBuffer({
            size: readbackSize,
            usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });

        const copyEncoder = gpu.device.createCommandEncoder();
        copyEncoder.copyBufferToBuffer(
            tgt.vertexBuffer!,
            0,
            readBuffer,
            0,
            readbackSize
        );
        gpu.device.queue.submit([copyEncoder.finish()]);

        // Async operation to wait for calculated points to be read back from GPU.
        await readBuffer.mapAsync(GPUMapMode.READ);
        const mapped = readBuffer.getMappedRange();
        const vertexBytes = new Uint8Array(mapped);

        const posOffsetInVertex = 0;
        const floatView = new Float32Array(vertexBytes.buffer, vertexBytes.byteOffset, vertexBytes.byteLength / 4);

        let pointScales: Float32Array | null = null;
        if (pointAttributeBuffer) {
            pointScales = null;
        }

        const bboxArray = new Float32Array(instanceCount * 6);

        // Source bounding box / sphere.
        const srcBox = src.boundingBox;
        const srcSphere = src.boundingSphere;

        // TODO: Might move all of this to the GPU, computing bounding boxes for a larger quantity of shapes may be rather difficult.
        // Precompute src box center and half-extents (local space).
        const srcCenter = [
            (srcBox.min[0] + srcBox.max[0]) * 0.5,
            (srcBox.min[1] + srcBox.max[1]) * 0.5,
            (srcBox.min[2] + srcBox.max[2]) * 0.5,
        ];
        const srcHalf = [
            (srcBox.max[0] - srcBox.min[0]) * 0.5,
            (srcBox.max[1] - srcBox.min[1]) * 0.5,
            (srcBox.max[2] - srcBox.min[2]) * 0.5,
        ];

        // conservative rotation handling: if orientation exists per-point and you want to support rotation exactly,
        // prefer computing on GPU or expanding extents to max axis length: use sphere radius as fallback to produce safe AABB.
        const useSphereFallback = true;

        for (let i = 0; i < instanceCount; ++i) {
            const vertBaseFloatIndex = (vertexStrideBytes / 4) * i + (posOffsetInVertex / 4);
            const px = floatView[vertBaseFloatIndex + 0];
            const py = floatView[vertBaseFloatIndex + 1];
            const pz = floatView[vertBaseFloatIndex + 2];

            // scale per instance: default 1.0 unless you read pscale.
            let instanceScale = 1.0;
            if (pointScales) {
                instanceScale = pointScales[i];
            }

            // compute world-space center and half extents (simple: scale around origin then translate).
            const worldCenter = [
                srcCenter[0] * instanceScale + px,
                srcCenter[1] * instanceScale + py,
                srcCenter[2] * instanceScale + pz,
            ];

            if (useSphereFallback) {
                // Use bounding sphere radius scaled as conservative half-extent in all axes.
                const r = srcSphere.radius * instanceScale;
                const minx = worldCenter[0] - r;
                const miny = worldCenter[1] - r;
                const minz = worldCenter[2] - r;
                const maxx = worldCenter[0] + r;
                const maxy = worldCenter[1] + r;
                const maxz = worldCenter[2] + r;
                const base = i * 6;
                bboxArray[base + 0] = minx;
                bboxArray[base + 1] = miny;
                bboxArray[base + 2] = minz;
                bboxArray[base + 3] = maxx;
                bboxArray[base + 4] = maxy;
                bboxArray[base + 5] = maxz;
            } else {
                // Exact axis-aligned box by scaling srcHalf and translating.
                const hx = srcHalf[0] * instanceScale;
                const hy = srcHalf[1] * instanceScale;
                const hz = srcHalf[2] * instanceScale;
                const minx = worldCenter[0] - hx;
                const miny = worldCenter[1] - hy;
                const minz = worldCenter[2] - hz;
                const maxx = worldCenter[0] + hx;
                const maxy = worldCenter[1] + hy;
                const maxz = worldCenter[2] + hz;
                const base = i * 6;
                bboxArray[base + 0] = minx;
                bboxArray[base + 1] = miny;
                bboxArray[base + 2] = minz;
                bboxArray[base + 3] = maxx;
                bboxArray[base + 4] = maxy;
                bboxArray[base + 5] = maxz;
            }
        }

        readBuffer.unmap();

        const bboxByteLength = bboxArray.byteLength; // instanceCount * 6 * 4
        this.boundingBoxBuffer = gpu.device.createBuffer({
            size: bboxByteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
            label: "copyToPoints bounding boxes buffer",
        });

        gpu.device.queue.writeBuffer(this.boundingBoxBuffer, 0, bboxArray.buffer, bboxArray.byteOffset, bboxByteLength);

        // geomID buffer: for now we can set all to src.id (or an integer index you maintain).
        const geomIDs = new Uint32Array(instanceCount);
        // If your src has an integer id, use it; otherwise assign 0 for now.
        const srcIdNum = (typeof src.id === "number") ? src.id : 0;
        for (let i = 0; i < instanceCount; ++i) geomIDs[i] = srcIdNum;

        const geomIdBytes = geomIDs.byteLength;
        this.geomIDBuffer = gpu.device.createBuffer({
            size: geomIdBytes,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
            label: "copyToPoints geometry IDs buffer",
        });
        gpu.device.queue.writeBuffer(this.geomIDBuffer, 0, geomIDs.buffer, geomIDs.byteOffset, geomIdBytes);

        // done
        console.log("CopyToPoints: bounding buffers created. instances=", instanceCount);
    }

    // TODO I think maybe we ought to get rid of executes? I'm not sure we actually really use them for anything outside of node calling own execute in order to call their own applyModification when we could just call applyModification directly
    async execute(inputs?: Record<string, any>) {
        const geom = inputs?.geometry0?.[0] as GeometryData;
        const geom2 = inputs?.geometry1?.[0] as GeometryData;
        if (!geom) {
            console.warn("CopyToPointsNode: No input geometry");
            return;
        }

        if (!geom2) {
            console.warn("CopyToPointsNode: No second input geometry");
            return;
        }

        this.geometry = this.applyModificationMultiple([geom, geom2]);
        return { geometry: this.geometry };
    }

    getEditableControls() {
        return {
        };
    }
}