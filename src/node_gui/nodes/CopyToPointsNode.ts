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
        // applyModificationMultiple(input: GeometryData, input2: GeometryData): GeometryData | undefined {
        // if (!input || !input2) return;

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

        // TODO: Reinstantiate compute pipelines for copy to points.
        // Need vertexBuffers for both objects.
        // TODO: Update wireframe buffers for CpyToPts logic.
        this.updateUniformBuffer();
        this.setupComputePipeline(src.vertexBuffer!, src.indexBuffer!, tgt.vertexBuffer!, pointAttributeBuffer, outputVertexBuffer, outputIndexBuffer, this.cpyToPtsUniformBuffer);
        this.SetupWireframe(outputIndexBuffer, outputWireframeBuffer, triangleCount);

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