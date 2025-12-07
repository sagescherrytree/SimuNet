import { Node } from "./Node";
import { GeometryData, removeGeometry } from "../geometry/geometry";
import { IGeometryModifier } from "../interfaces/NodeCapabilities";
import { IVertexDeformer } from "../interfaces/NodeCapabilities";
import { GPUContext } from "../../webgpu/GPUContext";
// Import merge compute shader.
import mergeComputeShader from '../../webgpu/shaders/merge.cs.wgsl';

export class MergeNode
    extends Node
    implements IGeometryModifier {
    public inputGeometries?: GeometryData[];
    private numInputs = 2;

    // TODO rename?
    mergeComputeBindGroupLayout: GPUBindGroupLayout;
    mergeComputeBindGroup: GPUBindGroup;
    mergeComputePipeline: GPUComputePipeline;

    // Workgroup size.
    workgroupSize = 64;

    constructor() {
        super("Merge");

        this.ioBehavior.addGeometryInput();
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

        this.setupComputePipeline();

        // Invoke compute pass.
        const encoder = gpu.device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.mergeComputePipeline);
        pass.setBindGroup(0, this.mergeComputeBindGroup);

        // operating per triangle; so vertexCount/3s
        const workgroups = Math.ceil(this.vertexCountTgt / 3 / this.workgroupSize);
        pass.dispatchWorkgroups(workgroups);

        pass.end();
        gpu.device.queue.submit([encoder.finish()]);

        this.geometry = {
            vertexBuffer: outputVertexBuffer,
            indexBuffer: outputIndexBuffer,
            wireframeIndexBuffer: input1.wireframeIndexBuffer,
            id: this.id,
            sourceId: input1.sourceId ?? input1.id,
            materialBuffer: input1.materialBuffer
        };

        return this.geometry;
    }

    setupComputePipeline() {
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
                { binding: 6, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } }, // counts
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