import { Node } from "./Node";
import { GeometryData, removeGeometry } from "../geometry/geometry";
import { NumberControl } from "../controls/NumberControl";
import { IGeometryModifier } from "../interfaces/NodeCapabilities";
// Might need to add vertex deformer for cloth sim, but that on CPU.
import { GPUContext } from "../../webgpu/GPUContext";
// Import cloth compute shader.
import clothSimComputeShader from '../../webgpu/shaders/clothSim.cs.wgsl';

// Cloth particle struct creation.
// Refernce from HW 4 Forward rendering camera.ts.
class ClothParticleCPU {
    static readonly STRIDE = 56; // must match WGSL Particle struct

    buffer: ArrayBuffer;
    floatView: Float32Array;
    uintView: Uint32Array;

    constructor(count: number) {
        this.buffer = new ArrayBuffer(count * ClothParticleCPU.STRIDE);
        this.floatView = new Float32Array(this.buffer);
        this.uintView = new Uint32Array(this.buffer);
    }

    // Write a particle into the CPU buffer
    writeParticle(i: number, data: {
        position: number[],
        prevPosition: number[],
        velocity?: number[],
        mass: number,
        isFixed: number
    }) {
        const base = (ClothParticleCPU.STRIDE / 4) * i;

        // position.xyz, position.w = 0.
        this.floatView[base + 0] = data.position[0];
        this.floatView[base + 1] = data.position[1];
        this.floatView[base + 2] = data.position[2];
        this.floatView[base + 3] = 0;

        // prevPosition.
        this.floatView[base + 4] = data.prevPosition[0];
        this.floatView[base + 5] = data.prevPosition[1];
        this.floatView[base + 6] = data.prevPosition[2];
        this.floatView[base + 7] = 0;

        // velocity.
        const vx = data.velocity ?? [0, 0, 0];
        this.floatView[base + 8] = vx[0];
        this.floatView[base + 9] = vx[1];
        this.floatView[base + 10] = vx[2];
        this.floatView[base + 11] = 0;

        // mass.
        this.floatView[base + 12] = data.mass;

        // isFixed.
        this.uintView[(base + 13)] = data.isFixed;

        // padding, to account for bit size being multiple of 16.
        this.floatView[base + 14] = 0;
    }
}

export class ClothNode
    extends Node
    implements IGeometryModifier {
    public inputGeometry?: GeometryData;

    clothSimUniformBuffer?: GPUBuffer;

    // Custom for cloth sim, particle buffer.
    // Pingpong buffers for passing information.
    particleBuffer1: GPUBuffer;
    particleBuffer2: GPUBuffer;

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

        // Fill particle buffers.
        const particleCount = vertexCount;
        const cpuParticles = new ClothParticleCPU(particleCount);

        // Still using CPU vertices, TODO change to read from GPU vertex buffer evetually.
        this.fillParticleBuffer(cpuParticles, input.vertices, vertexCount);

        // Ping-pong GPU buffers.
        this.particleBuffer1 = gpu.device.createBuffer({
            size: cpuParticles.buffer.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });

        this.particleBuffer2 = gpu.device.createBuffer({
            size: cpuParticles.buffer.byteLength,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });

        // Upload initial data to buffer1
        gpu.device.queue.writeBuffer(this.particleBuffer1, 0, cpuParticles.buffer);

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

    // Fill particle buffer.
    fillParticleBuffer(clothPartBufferCPU: ClothParticleCPU, vertices: Float32Array, vertexCount: number) {
        const stride = 8; // float count per vertex (vec4 + vec4)

        for (let i = 0; i < vertexCount; i++) {
            const base = i * stride;
            const pos = [
                vertices[base + 0],
                vertices[base + 1],
                vertices[base + 2],
            ];

            clothPartBufferCPU.writeParticle(i, {
                position: pos,
                prevPosition: pos,
                velocity: [0, 0, 0], // initial
                mass: this.massControl.value,
                isFixed: this.isEdgePinned(i, vertexCount) ? 1 : 0,
            });
        }
    }

    isEdgePinned(vertexIndex: number, vertexCount: number) {
        // TODO: Implement pinned edge logic. 
        return false;
    }

    updateUniformBuffer() {
        const gpu = GPUContext.getInstance();

        // Stiffness, mass, damping, gravity.
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
            entries: [ // TODO: Need to adjust to particle buffers.
                { binding: 0, resource: { buffer: vertexBuffer } },
                { binding: 1, resource: { buffer: outputVertexBuffer } },
                { binding: 2, resource: { buffer: this.clothSimUniformBuffer! } },
            ]
        });

        // TODO: Transfer positions from particle buffer to outputVertexBuffer.
        // Do this either in compute shader or on CPU side via copyBuffertoBuffer?

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
