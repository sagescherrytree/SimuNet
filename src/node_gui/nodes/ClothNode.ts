import { Node } from "./Node";
import { GeometryData, removeGeometry } from "../geometry/geometry";
import { NumberControl } from "../controls/NumberControl";
import { IGeometryModifier } from "../interfaces/NodeCapabilities";
// Might need to add vertex deformer for cloth sim, but that on CPU.
import { GPUContext } from "../../webgpu/GPUContext";
// Import cloth compute shader.
import clothSimComputeShader from '../../webgpu/shaders/clothSim.cs.wgsl';

export class ClothNode
    extends Node
    implements IGeometryModifier {
    public inputGeometry?: GeometryData;

    clothSimUniformBuffer?: GPUBuffer;

    clothSimComputeBindGroupLayout: GPUBindGroupLayout;
    clothSimComputeBindGroup: GPUBindGroup;
    clothSimComputePipeline: GPUComputePipeline;

    // Workgroup size.
    workgroupSize = 64;

    // Controls for cloth sim.
    stiffnessControl: NumberControl;
    massControl: NumberControl;
    dampingControl: NumberControl;
    gravityControl: NumberControl;
    // TODO: add time step control.

    constructor() {
        super("ClothNode");

        this.ioBehavior.addGeometryInput();
        this.ioBehavior.addGeometryOutput();

        const onChange = () => {
            if (this.inputGeometry) {
                this.applyModification(this.inputGeometry);
            }
            this.updateBehavior.triggerUpdate();
        };

        this.stiffnessControl = new NumberControl("Stiffness", 0.5, onChange, 0.1);
        this.massControl = new NumberControl("Mass", 0.5, onChange, 0.1);
        this.dampingControl = new NumberControl("Dampening", 1.0, onChange, 0.1);
        this.gravityControl = new NumberControl("Gravity", 0, onChange, 1, 0, 1000);
    }

    setInputGeometry(geometry: GeometryData) {
        this.inputGeometry = geometry;
        this.applyModification(this.inputGeometry);
    }

    // Need another input for second geom.

    applyModification(input: GeometryData): GeometryData | undefined {
        if (!input) return;

        const stride = 8 * 4; // 32 bytes to fit vec4 padding.
        const vertexCount = input.vertexBuffer!.size / stride;

        // GPU stuffs.
        const gpu = GPUContext.getInstance();

        // Set up buffers.
        // Input buffers for verts and indices.
        const vertexBuffer = input.vertexBuffer;
        const indexBuffer = input.indexBuffer;

        console.log("ClothNode: incoming vertexBuffer", vertexBuffer);
        console.log("ClothNode: incoming vertex buffer size:", vertexBuffer?.size);

        // Output buffer for transformed vertices.
        const outputVertexBuffer = gpu.device.createBuffer({
            size: input.vertexBuffer!.size,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC,
        });

        this.updateUniformBuffer();
        this.setupComputePipeline(vertexBuffer!, outputVertexBuffer);

        // Invoke compute pass.
        const encoder = gpu.device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(this.clothSimComputePipeline);
        pass.setBindGroup(0, this.clothSimComputeBindGroup);

        const workgroups = Math.ceil(vertexCount / this.workgroupSize);
        pass.dispatchWorkgroups(workgroups);

        pass.end();
        gpu.device.queue.submit([encoder.finish()]);

        // Debug.
        gpu.device.queue.onSubmittedWorkDone().then(async () => {
            const readBuffer = gpu.device.createBuffer({
                size: outputVertexBuffer.size,
                usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
            });

            const enc = gpu.device.createCommandEncoder();
            enc.copyBufferToBuffer(
                outputVertexBuffer,
                0,
                readBuffer,
                0,
                outputVertexBuffer.size
            );
            gpu.device.queue.submit([enc.finish()]);

            await readBuffer.mapAsync(GPUMapMode.READ);
            const gpuVerts = new Float32Array(readBuffer.getMappedRange());
            console.log("[ClothNode.ts] GPU output vertices:", gpuVerts);
        });

        // const deformed = this.deformVertices(input.vertices);

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

    updateUniformBuffer() {
        const gpu = GPUContext.getInstance();

        // strength, scale, seed, padding
        const data = new Float32Array([
            this.stiffnessControl.value,
            this.massControl.value,
            this.dampingControl.value,
            this.gravityControl.value,
        ]);

        if (!this.clothSimUniformBuffer) {
            this.clothSimUniformBuffer = gpu.device.createBuffer({
                size: data.byteLength,
                usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            });
        }

        gpu.device.queue.writeBuffer(this.clothSimUniformBuffer, 0, data);
    }

    // Pass in buffers for input vertices.
    setupComputePipeline(vertexBuffer: GPUBuffer, outputVertexBuffer: GPUBuffer) {
        const gpu = GPUContext.getInstance();

        this.clothSimComputeBindGroupLayout = gpu.device.createBindGroupLayout({
            label: "cloth sim compute BGL",
            entries: [
                { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
                { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
                { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
            ]
        });

        const shaderModule = gpu.device.createShaderModule({
            label: "cloth sim compute shader",
            code: clothSimComputeShader,
        });

        const pipelineLayout = gpu.device.createPipelineLayout({
            label: "cloth sim compute layout",
            bindGroupLayouts: [this.clothSimComputeBindGroupLayout]
        });

        this.clothSimComputePipeline = gpu.device.createComputePipeline({
            label: "cloth sim compute pipeline",
            layout: pipelineLayout,
            compute: { module: shaderModule, entryPoint: "main" },
        });

        this.clothSimComputeBindGroup = gpu.device.createBindGroup({
            layout: this.clothSimComputeBindGroupLayout,
            entries: [
                { binding: 0, resource: { buffer: vertexBuffer } },
                { binding: 1, resource: { buffer: outputVertexBuffer } },
                { binding: 2, resource: { buffer: this.clothSimUniformBuffer! } },
            ]
        });

        console.log("ClothSimNode: compute shader loaded");
        console.log("ClothSimNode: pipeline created:", this.clothSimComputePipeline);
        console.log("ClothSimNode: bind group:", this.clothSimComputeBindGroup);
    }

    async execute(inputs?: Record<string, any>) {
        const geom = inputs?.geometry?.[0] as GeometryData;
        if (!geom) {
            console.warn("ClothSimNode: No input geometry");
            return;
        }

        this.geometry = this.applyModification(geom);
        return { geometry: this.geometry };
    }

    getEditableControls() {
        return {
            stiffness: this.stiffnessControl,
            mass: this.massControl,
            damping: this.dampingControl,
            gravity: this.gravityControl,
        };
    }
}
