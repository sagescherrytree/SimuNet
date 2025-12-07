import { Node } from "./Node";
import { GeometryData, removeGeometry } from "../geometry/geometry";
import { NumberControl } from "../controls/NumberControl";
import { IGeometryModifier } from "../interfaces/NodeCapabilities";
import { GPUContext } from "../../webgpu/GPUContext";
import { Vec3Control } from "../controls/Vec3Control";
import { DropdownControl } from "../controls/DropdownControl";
// Import attrib randomize compute shader.
import attribRandComputeShader from '../../webgpu/shaders/attribRand.cs.wgsl';

export class AttribRandNode
    extends Node
    implements IGeometryModifier {

    public inputGeometry?: GeometryData;

    attribRandUniformBuffer?: GPUBuffer;

    attribRandComputeBindGroupLayout: GPUBindGroupLayout;
    attribRandComputeBindGroup: GPUBindGroup;
    attribRandComputePipeline: GPUComputePipeline;

    // Workgroup size.
    workgroupSize = 64;

    // Set AttribRand controls.
    // Scale is uniform scale, functions similar to pscale from Houdini.
    scaleMinControl: NumberControl;
    scaleMaxControl: NumberControl;
    // Random rotation on if 1, else off.
    rotationControl: DropdownControl;

    // TODO: Add control for type of distribution needed?

    constructor() {
        super("AttribRand");

        this.ioBehavior.addGeometryInput();
        this.ioBehavior.addGeometryOutput();

        const onChange = () => {
            if (this.inputGeometry) {
                this.applyModification(this.inputGeometry);
            }
            this.updateBehavior.triggerUpdate();
        };

        this.scaleMinControl = new NumberControl("Scale Min Val", 0.5, onChange, 0.1);
        this.scaleMaxControl = new NumberControl("Scale Max Val", 2.0, onChange, 0.1);
        this.rotationControl = new DropdownControl("Random Rotation", 0, onChange, [
            { value: 0, label: "Off" },
            { value: 1, label: "On" },
        ]);
    }

    setInputGeometry(geometry: GeometryData) {
        this.inputGeometry = geometry;
        this.applyModification(this.inputGeometry);
    }

    applyModification(input: GeometryData): GeometryData | undefined {
        if (!input) return;

        // GPU stuffs.
        const gpu = GPUContext.getInstance();

        // Set up buffers.
        // Input buffers for verts and indices.
        const vertexBuffer = input.vertexBuffer;
        const indexBuffer = input.indexBuffer;

        console.log("AttribRand: incoming vertexBuffer", vertexBuffer);
        console.log("AttribRand: incoming vertex buffer size:", vertexBuffer?.size);

        // Create point attrib buffer.
        // Should probably be completely empty because we have yet to fill it.
        this.createPointAttribBuffer(input);

        const pointStride = 48;
        const pointCount = input.pointAttributeBuffer!.size / pointStride;

        // No output vertex buffer, because we do not modify vertices in any way.
        this.updateUniformBuffer(pointCount);
        this.setupComputePipeline(input.pointAttributeBuffer!);

        // Invoke compute pass.
        const encoder = gpu.device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.attribRandComputePipeline);
        pass.setBindGroup(0, this.attribRandComputeBindGroup);

        // operating per triangle; so indexCount/3s
        const workgroups = Math.ceil(pointCount / this.workgroupSize);
        pass.dispatchWorkgroups(workgroups);

        pass.end();
        gpu.device.queue.submit([encoder.finish()]);

        this.geometry = {
            vertexBuffer: vertexBuffer,
            indexBuffer: indexBuffer,
            wireframeIndexBuffer: input.wireframeIndexBuffer,
            id: this.id,
            sourceId: input.sourceId ?? input.id,
            materialBuffer: input.materialBuffer,
            pointAttributeBuffer: input.pointAttributeBuffer,
        };

        return this.geometry;
    }

    createPointAttribBuffer(geom: GeometryData) {
        const gpu = GPUContext.getInstance();
        const stride = 48; // bytes per attribute
        const vertCount = geom.vertexBuffer ? (geom.vertexBuffer.size / 32) : (geom.vertices ? geom.vertices.length / 8 : 0);

        const neededSize = vertCount * stride;

        if (geom.pointAttributeBuffer && geom.pointAttributeBuffer.size === neededSize) {
            geom.pointAttributeBuffer;
        } else {
            geom.pointAttributeBuffer = gpu.device.createBuffer({
                size: neededSize,
                usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
            });

            // initialize defaults
            const f32 = new Float32Array((vertCount * stride) / 4);
            for (let i = 0; i < vertCount; i++) {
                const offset = i * 12;
                f32[offset + 0] = 1.0;  // pscale
                f32[offset + 1] = 0.0;  // padding
                f32[offset + 2] = 1.0;  // scale.x
                f32[offset + 3] = 1.0;  // scale.y
                f32[offset + 4] = 1.0;  // scale.z

                // quaternion identity
                f32[offset + 8] = 0.0;
                f32[offset + 9] = 0.0;
                f32[offset + 10] = 0.0;
                f32[offset + 11] = 1.0;
            }

            gpu.device.queue.writeBuffer(geom.pointAttributeBuffer, 0, f32);
        }
    }

    updateUniformBuffer(pointCount: number) {
        const gpu = GPUContext.getInstance();

        const useRandom = Number(this.rotationControl.value) || 0;

        const data = new Float32Array([
            this.scaleMinControl.value,
            this.scaleMaxControl.value,
            useRandom,
            0.0,
            pointCount,
            0.0,
            0.0,
            0.0
        ]);
        if (!this.attribRandUniformBuffer) {
            this.attribRandUniformBuffer = gpu.device.createBuffer({
                size: data.byteLength,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
        }
        gpu.device.queue.writeBuffer(this.attribRandUniformBuffer, 0, data);
    }

    // Pass in buffers for input vertices.
    setupComputePipeline(pointAttribBuffer: GPUBuffer) {
        const gpu = GPUContext.getInstance();

        this.attribRandComputeBindGroupLayout = gpu.device.createBindGroupLayout({
            label: "attribute randomize compute BGL",
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
            ],
        });

        let shaderModule = gpu.device.createShaderModule({
            label: "attribute randomize compute shader",
            code: attribRandComputeShader,
        });


        const pipelineLayout = gpu.device.createPipelineLayout({
            label: "attribute randomize compute layout",
            bindGroupLayouts: [this.attribRandComputeBindGroupLayout]
        });

        this.attribRandComputePipeline = gpu.device.createComputePipeline({
            label: "attribute randomize compute pipeline",
            layout: pipelineLayout,
            compute: { module: shaderModule, entryPoint: "main" },
        });

        this.attribRandComputeBindGroup = gpu.device.createBindGroup({
            layout: this.attribRandComputeBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: pointAttribBuffer } },
                { binding: 1, resource: { buffer: this.attribRandUniformBuffer! } },
            ],
        });

        console.log("AttribRandNode: compute shader loaded");
        console.log("AttribRandNode: pipeline created:", this.attribRandComputePipeline);
        console.log("AttribRandNode: bind group:", this.attribRandComputeBindGroup);
    }

    async execute(inputs?: Record<string, any>) {
        const geom = inputs?.geometry?.[0] as GeometryData;
        if (!geom) {
            console.warn("AttribRandNode: No input geometry");
            return;
        }

        this.geometry = this.applyModification(geom);
        return { geometry: this.geometry };
    }

    getEditableControls() {
        return {
            scaleMin: this.scaleMinControl,
            scaleMax: this.scaleMaxControl,
            rotation: this.rotationControl,
        };
    }
}