import { Node } from "./Node";
import { GeometryData, removeGeometry } from "../geometry/geometry";
import { IGeometryModifier } from "../interfaces/NodeCapabilities";
import { GPUContext } from "../../webgpu/GPUContext";
// Import merge compute shader.
import mergeComputeShader from '../../webgpu/shaders/merge.cs.wgsl';
// For wireframe recompute.
import mergeWireframeComputeShader from '../../webgpu/shaders/wireframe.cs.wgsl'

export class MergeNode
    extends Node
    implements IGeometryModifier {
    public inputGeometries?: GeometryData[];
    private numInputs = 2;

    vertexCount1 = 0;
    indexCount1 = 0;
    vertexCount2 = 0;
    indexCount2 = 0;
    stride = 32;

    mergeUniformBuffer?: GPUBuffer;

    mergeComputeBindGroupLayout: GPUBindGroupLayout;
    mergeComputeBindGroup: GPUBindGroup;
    mergeComputePipeline: GPUComputePipeline;

    // For wireframe buffer.
    mergeWireframeUniformBuffer?: GPUBuffer;

    mergeWireframePipeline: GPUComputePipeline;
    mergeWireframeBindGroupLayout: GPUBindGroupLayout;
    mergeWireframeBindGroup: GPUBindGroup;

    // Workgroup size.
    workgroupSize = 64;

    constructor() {
        super("Merge");

        this.ioBehavior.addMultipleInputs(2);
        this.ioBehavior.addGeometryOutput();
        this.inputGeometries = [];

        const onChange = () => {
            this.applyModificationMultiple(this.inputGeometries);
            this.updateBehavior.triggerUpdate();
        };
    }

    setInputGeometry(geometry: GeometryData, index: number = 0) {
        this.inputGeometries[index] = geometry;
        this.applyModificationMultiple(this.inputGeometries);
    }

    applyModificationMultiple(inputs: GeometryData[]): GeometryData | undefined {

        for (let i = 0; i < this.numInputs; ++i) {
            if (!inputs[i]) {
                return;
            }
        }

        const input1 = inputs[0]; // Source (geom to be copied)
        const input2 = inputs[1]; // Target (points to be copied to)

        // GPU stuffs.
        const gpu = GPUContext.getInstance();

        // Get vertex and index buffers of both shapes.
        const vertexBuffer1 = input1.vertexBuffer;
        const indexBuffer1 = input1.indexBuffer;
        const vertexBuffer2 = input2.vertexBuffer;
        const indexBuffer2 = input2.indexBuffer;

        // Count
        this.vertexCount1 = vertexBuffer1!.size / this.stride;
        this.indexCount1 = indexBuffer1!.size / 4;
        this.vertexCount2 = vertexBuffer2!.size / this.stride;
        this.indexCount2 = indexBuffer2!.size / 4;

        // Output vertexBuffer and indexBuffer should be just the two input ones merged.
        // Total count is vertBuffer1.count * vertBuffer2.count.
        const outVertexCount = this.vertexCount1 + this.vertexCount2;
        const outIndexCount = this.indexCount1 + this.indexCount2;

        const outVertexSize = outVertexCount * this.stride;
        const outIndexSize = outIndexCount * 4;

        const outputVertexBuffer = gpu.device.createBuffer({
            size: outVertexSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC,
        });

        const outputIndexBuffer = gpu.device.createBuffer({
            size: outIndexSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDEX | GPUBufferUsage.COPY_SRC,
        });

        const triangleCount = outIndexCount / 3;
        const wireframeSize = triangleCount * 6 * 4;
        const outputWireframeBuffer = gpu.device.createBuffer({
            size: wireframeSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.INDEX | GPUBufferUsage.COPY_SRC,
        });

        this.updateUniformBuffer();
        // Takes in vert buffers, index buffers, output buffers (wireframe later) from both inputs.
        this.setupComputePipeline(vertexBuffer1, indexBuffer1, vertexBuffer2, indexBuffer2, outputVertexBuffer, outputIndexBuffer);
        this.SetupWireframe(outputIndexBuffer, outputWireframeBuffer, outIndexCount);

        // Invoke compute pass.
        const encoder = gpu.device.createCommandEncoder();
        let pass = encoder.beginComputePass();
        pass.setPipeline(this.mergeComputePipeline);
        pass.setBindGroup(0, this.mergeComputeBindGroup);

        // operating per triangle; so vertexCount/3s
        const totalOperations = outVertexCount + outIndexCount;
        const workgroups = Math.ceil(totalOperations / this.workgroupSize);
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
            wireframeIndexBuffer: outputWireframeBuffer,
            id: this.id,
            sourceId: input1.sourceId ?? input1.id,
            materialBuffer: input1.materialBuffer
        };

        return this.geometry;
    }

    updateUniformBuffer() {
        const gpu = GPUContext.getInstance();

        // Uniforms to pass to shader for merging logic.
        const data = new Uint32Array([this.vertexCount1, this.indexCount1, this.vertexCount2, this.indexCount2]);

        if (!this.mergeUniformBuffer) {
            this.mergeUniformBuffer = gpu.device.createBuffer({
                size: data.byteLength,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
        }

        gpu.device.queue.writeBuffer(this.mergeUniformBuffer, 0, data);
    }

    setupComputePipeline(vertexBuffer1: GPUBuffer, indexBuffer1: GPUBuffer, vertexBuffer2: GPUBuffer, indexBuffer2: GPUBuffer,
        outputVertexBuffer: GPUBuffer, outputIndexBuffer: GPUBuffer
    ) {
        const gpu = GPUContext.getInstance();

        this.mergeComputeBindGroupLayout = gpu.device.createBindGroupLayout({
            label: "merge compute BGL",
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // input1 vertices
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // input1 indices
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // input2 vertices
                { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } }, // input2 indices
                { binding: 4, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // out vertices
                { binding: 5, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } }, // out indices
                { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } }, // uniforms
            ]
        });

        let shaderModule = gpu.device.createShaderModule({
            label: "merge compute shader",
            code: mergeComputeShader,
        });


        const pipelineLayout = gpu.device.createPipelineLayout({
            label: "merge compute layout",
            bindGroupLayouts: [this.mergeComputeBindGroupLayout]
        });

        this.mergeComputePipeline = gpu.device.createComputePipeline({
            label: "merge compute pipeline",
            layout: pipelineLayout,
            compute: { module: shaderModule, entryPoint: "main" },
        });

        this.mergeComputeBindGroup = gpu.device.createBindGroup({
            layout: this.mergeComputeBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: vertexBuffer1 } },
                { binding: 1, resource: { buffer: indexBuffer1 } },
                { binding: 2, resource: { buffer: vertexBuffer2 } },
                { binding: 3, resource: { buffer: indexBuffer2 } },
                { binding: 4, resource: { buffer: outputVertexBuffer } },
                { binding: 5, resource: { buffer: outputIndexBuffer } },
                { binding: 6, resource: { buffer: this.mergeUniformBuffer } },
            ]
        });

        console.log("MergeNode: compute shader loaded"); // do we even need one wwwww.
        console.log("MergeNode: pipeline created:", this.mergeComputePipeline);
        console.log("MergeNode: bind group:", this.mergeComputeBindGroup);
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

    // TODO I think maybe we ought to get rid of executes?
    async execute(inputs?: Record<string, any>) {
        const geom = inputs?.geometry0?.[0] as GeometryData;
        const geom2 = inputs?.geometry1?.[0] as GeometryData;
        if (!geom) {
            console.warn("MergeNode: No input geometry");
            return;
        }

        if (!geom2) {
            console.warn("MergeNode: No second input geometry");
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