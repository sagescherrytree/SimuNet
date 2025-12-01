import { Node } from "./Node";
import { GeometryData, removeGeometry } from "../geometry/geometry";
import { IGeometryModifier } from "../interfaces/NodeCapabilities";
import { GPUContext } from "../../webgpu/GPUContext";
// Import recompute normals compute shader.
import copyToPointsComputeShader from '../../webgpu/shaders/copyToPoints.cs.wgsl';


export class CopyToPointsNode extends Node implements IGeometryModifier {
    public inputGeometry?: GeometryData;

    cpyToPtsUniformBuffer?: GPUBuffer;

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
                this.applyModification(this.inputGeometry);
            }
            this.updateBehavior.triggerUpdate();
        };
    }

    setInputGeometry(geometry: GeometryData) {
        this.inputGeometry = geometry;
        this.applyModification(this.inputGeometry);
    }

    applyModification(input: GeometryData): GeometryData | undefined {
        if (!input) return;

        const stride = 8 * 4; // 32 bytes to fit vec4 padding.
        const vertexCount = input.vertexBuffer!.size / stride;
        const indexCount = input.indexBuffer!.size / 4; // integers = 4 bytes

        // GPU stuffs.
        const gpu = GPUContext.getInstance();

        // Set up buffers.
        // Input buffers for verts and indices.
        const vertexBuffer = input.vertexBuffer;
        const indexBuffer = input.indexBuffer;

        console.log("CopyToPointsNode: incoming vertexBuffer", vertexBuffer);
        console.log("CopyToPointsNode: incoming vertex buffer size:", vertexBuffer?.size);

        // Output buffer for transformed vertices.
        // This outputVertexBuffer should hold all vertices of the geometries that are copied to points.
        const outputVertexBuffer = gpu.device.createBuffer({
            size: input.vertexBuffer!.size,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC,
        });

        // TODO: Reinstantiate compute pipelines for copy to points.
        // Need vertexBuffers for both objects.
        this.setupComputePipeline(vertexBuffer!, outputVertexBuffer, indexBuffer!);

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
            indexBuffer: indexBuffer,
            wireframeIndexBuffer: input.wireframeIndexBuffer,
            id: this.id,
            sourceId: input.sourceId ?? input.id,
        };

        return this.geometry;
    }

    // Pass in buffers for input vertices.
    setupComputePipeline(vertexBuffer: GPUBuffer, outputVertexBuffer: GPUBuffer, indexBuffer: GPUBuffer) {
        const gpu = GPUContext.getInstance();

        this.cpyToPtsComputeBindGroupLayout = gpu.device.createBindGroupLayout({
            label: "copy to points compute BGL",
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
                // { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
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
                { binding: 0, resource: { buffer: vertexBuffer } },
                { binding: 1, resource: { buffer: outputVertexBuffer } },
                { binding: 2, resource: { buffer: indexBuffer } },
                // { binding: 2, resource: { buffer: this.deformationUniformBuffer! } },
            ]
        });

        console.log("CopyToPointsNode: compute shader loaded");
        console.log("CopyToPointsNode: pipeline created:", this.cpyToPtsComputePipeline);
        console.log("CopyToPointsNode: bind group:", this.cpyToPtsComputeBindGroup);
    }

    async execute(inputs?: Record<string, any>) {
        const geom = inputs?.geometry?.[0] as GeometryData;
        if (!geom) {
            console.warn("CopyToPointsNode: No input geometry");
            return;
        }

        this.geometry = this.applyModification(geom);
        return { geometry: this.geometry };
    }

    getEditableControls() {
        return {
        };
    }
}