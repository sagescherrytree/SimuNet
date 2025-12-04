import { Node } from "./Node";
import { GeometryData, removeGeometry } from "../geometry/geometry";
import { IGeometryModifier } from "../interfaces/NodeCapabilities";
import { GPUContext } from "../../webgpu/GPUContext";
// Import recompute normals compute shader.
import copyToPointsComputeShader from '../../webgpu/shaders/copyToPoints.cs.wgsl';


export class CopyToPointsNode extends Node implements IGeometryModifier {
    public inputGeometry?: GeometryData;
    public inputGeometry2?: GeometryData;

    cpyToPtsUniformBuffer?: GPUBuffer;

    vertexCount1 = 0;
    vertexCount2 = 0;

    cpyToPtsComputeBindGroupLayout: GPUBindGroupLayout;
    cpyToPtsComputeBindGroup: GPUBindGroup;
    cpyToPtsComputePipeline: GPUComputePipeline;

    workgroupSize = 64;

    constructor() {
        super("CopyToPoints");

        this.ioBehavior.addMultipleInputs(2);
        this.ioBehavior.addGeometryOutput();

        const onChange = () => {
            if (this.inputGeometry) {
                this.applyModificationMultiple(this.inputGeometry, this.inputGeometry2);
            }
            this.updateBehavior.triggerUpdate();
        };
    }

    setInputGeometry(geometry: GeometryData) {
        this.inputGeometry = geometry;
        this.applyModificationMultiple(this.inputGeometry, this.inputGeometry2);
    }

    setInputGeometryMult(geometry1: GeometryData, geometry2: GeometryData) {
        this.inputGeometry = geometry1;
        this.inputGeometry2 = geometry2;
        this.applyModificationMultiple(this.inputGeometry, this.inputGeometry2);
    }

    applyModificationMultiple(input: GeometryData, input2: GeometryData): GeometryData | undefined {
        if (!input) return;

        // TODO: change logic for accounting for multiple vertex buffers.
        const stride = 8 * 4; // 32 bytes to fit vec4 padding.
        this.vertexCount1 = input.vertexBuffer!.size / stride;
        this.vertexCount2 = input2.vertexBuffer!.size / stride;

        const totalVertCount = this.vertexCount1 + this.vertexCount2;
        const indexCount = input.indexBuffer!.size / 4; // integers = 4 bytes

        // Test combiend vertex count buffers.
        console.log("Total vertex counts of both geoms: ", totalVertCount);

        // GPU stuffs.
        const gpu = GPUContext.getInstance();

        // Set up buffers. Pass in two vert buffers.
        const vertexBuffer1 = input.vertexBuffer;
        const vertexBuffer2 = input2.vertexBuffer;
        const indexBuffer1 = input.indexBuffer;
        const indexBuffer2 = input2.indexBuffer;

        console.log("CopyToPointsNode: incoming vertexBuffer 1", vertexBuffer1);
        console.log("CopyToPointsNode: incoming vertex buffer size:", vertexBuffer1?.size);
        console.log("CopyToPointsNode: incoming vertexBuffer 2", vertexBuffer2);
        console.log("CopyToPointsNode: incoming vertex buffer size:", vertexBuffer2?.size);

        // Output buffer for transformed vertices.
        // This outputVertexBuffer should hold all vertices of the geometries that are copied to points.
        const outputVertexBuffer = gpu.device.createBuffer({
            size: input.vertexBuffer!.size,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC,
        });

        // Output buffer for new indices.
        // This outputVertexBuffer should hold newly calculated indices of the geometries that are copied to points.
        const outputIndexBuffer = gpu.device.createBuffer({
            size: input.vertexBuffer!.size,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDEX | GPUBufferUsage.COPY_SRC,
        });

        // TODO: Reinstantiate compute pipelines for copy to points.
        // Need vertexBuffers for both objects.
        this.setupComputePipeline(vertexBuffer1!, vertexBuffer2!, indexBuffer1!, indexBuffer2!, outputVertexBuffer, outputIndexBuffer);

        // Invoke compute pass.
        const encoder = gpu.device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.cpyToPtsComputePipeline);
        pass.setBindGroup(0, this.cpyToPtsComputeBindGroup);

        // operating per triangle; so vertexCount/3s
        const workgroups = Math.ceil(indexCount / 3 / this.workgroupSize);
        pass.dispatchWorkgroups(workgroups);

        pass.end();
        gpu.device.queue.submit([encoder.finish()]);

        this.geometry = {
            vertices: new Float32Array(input.vertices),
            indices: new Uint32Array(input.indices),
            vertexBuffer: outputVertexBuffer,
            indexBuffer: outputIndexBuffer,
            wireframeIndexBuffer: input.wireframeIndexBuffer,
            id: this.id,
            sourceId: input.sourceId ?? input.id,
        };

        return this.geometry;
    }

    // Pass in buffers for input vertices.
    setupComputePipeline(vertexBuffer1: GPUBuffer, vertexBuffer2: GPUBuffer, indexBuffer1: GPUBuffer, indexBuffer2: GPUBuffer, outputVertexBuffer: GPUBuffer, outputIndexBuffer: GPUBuffer) {
        const gpu = GPUContext.getInstance();

        this.cpyToPtsComputeBindGroupLayout = gpu.device.createBindGroupLayout({
            label: "copy to points compute BGL",
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
                { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
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
                { binding: 0, resource: { buffer: vertexBuffer1 } },
                { binding: 1, resource: { buffer: vertexBuffer2 } },
                { binding: 2, resource: { buffer: outputVertexBuffer } },
                { binding: 3, resource: { buffer: indexBuffer1 } },
                { binding: 4, resource: { buffer: indexBuffer2 } },
                { binding: 5, resource: { buffer: outputIndexBuffer } },
            ]
        });

        console.log("CopyToPointsNode: compute shader loaded");
        console.log("CopyToPointsNode: pipeline created:", this.cpyToPtsComputePipeline);
        console.log("CopyToPointsNode: bind group:", this.cpyToPtsComputeBindGroup);
    }

    async execute(inputs?: Record<string, any>) {
        const geom = inputs?.geometry?.[0] as GeometryData;
        const geom2 = inputs?.geometry1?.[0] as GeometryData;
        if (!geom) {
            console.warn("CopyToPointsNode: No input geometry");
            return;
        }

        if (!geom2) {
            console.warn("CopyToPointsNode: No second input geometry");
            return;
        }

        this.geometry = this.applyModificationMultiple(geom, geom2);
        return { geometry: this.geometry };
    }

    getEditableControls() {
        return {
        };
    }
}