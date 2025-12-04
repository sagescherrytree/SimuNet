import { Node } from "./Node";
import { GeometryData, removeGeometry } from "../geometry/geometry";
import { NumberControl } from "../controls/NumberControl";
import { IGeometryModifier } from "../interfaces/NodeCapabilities";
// Might need to add vertex deformer for cloth sim, but that on CPU.
import { GPUContext } from "../../webgpu/GPUContext";
// Import cloth compute shader.
import clothSimComputeShader from "../../webgpu/shaders/clothSim.cs.wgsl";
// Maybe we can change this to be more efficient structurally, but for now, call renderer.
import { Renderer } from "../../webgpu/renderer";

// Cloth particle struct creation.
// Refernce from HW 4 Forward rendering camera.ts.
class ClothParticleCPU {
  static readonly STRIDE = 64; // must match WGSL Particle struct

  buffer: ArrayBuffer;
  floatView: Float32Array;
  uintView: Uint32Array;

  constructor(count: number) {
    this.buffer = new ArrayBuffer(count * ClothParticleCPU.STRIDE);
    this.floatView = new Float32Array(this.buffer);
    this.uintView = new Uint32Array(this.buffer);
  }

  // Write a particle into the CPU buffer
  writeParticle(
    i: number,
    data: {
      position: number[];
      prevPosition: number[];
      velocity?: number[];
      mass: number;
      isFixed: number;
    }
  ) {
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
    this.uintView[base + 13] = data.isFixed;

    // padding, to account for bit size being multiple of 16.
    this.floatView[base + 14] = 0;
  }
}

export class ClothNode extends Node implements IGeometryModifier {
  public inputGeometry?: GeometryData;

  clothSimUniformBuffer?: GPUBuffer;

  // Custom for cloth sim, particle buffer.
  // Pingpong buffers for passing information.
  particleBuffer1: GPUBuffer;
  particleBuffer2: GPUBuffer;

  private currentReadBuffer: GPUBuffer;
  private currentWriteBuffer: GPUBuffer;

  private outputVertexBuffer: GPUBuffer;

  // Time uniform buffer in local cloth node.
  // Should we change this? Should geometry carry time uniform buffer?
  timeUniformBuffer: GPUBuffer;

  // Vertex count to pass into renderer.
  private vertexCount: number = 0;

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

  private spacingX: number = 0.125;
  private spacingZ: number = 0.125;
  // TODO: add time step control.

  // grid dimensions??
  gridHeight: number;
  gridWidth: number;

  gridSizeBuffer: GPUBuffer;

  constructor() {
    super("Cloth");

    this.ioBehavior.addGeometryInput();
    this.ioBehavior.addGeometryOutput();

    const onChange = () => {
      if (this.inputGeometry) {
        this.applyModification(this.inputGeometry);
      }
      this.updateBehavior.triggerUpdate();
    };

    this.stiffnessControl = new NumberControl("Stiffness", 5.0, onChange, 0.1);
    this.massControl = new NumberControl("Mass", 1.0, onChange, 0.1);
    this.dampingControl = new NumberControl("Dampening", 0.01, onChange, 0.1);
    this.gravityControl = new NumberControl(
      "Gravity",
      5.0,
      onChange,
      1,
      0,
      1000
    );
  }

  setInputGeometry(geometry: GeometryData) {
    this.inputGeometry = geometry;
    this.applyModification(this.inputGeometry);
  }

  // Need another input for second geom.
  applyModification(input: GeometryData): GeometryData | undefined {
    if (!input) return;

    // GPU stuffs.
    const gpu = GPUContext.getInstance();

    // TODO remove once moved to GPU
    this.vertexCount = input.vertices.length / 8; // 8 floats per vertex

    const stride = 8;

    const uniqueX = new Set<number>();
    const uniqueZ = new Set<number>();

    let minX = Infinity;
    let maxX = -Infinity;
    let minZ = Infinity;
    let maxZ = -Infinity;

    const precisionFactor = 1000;

    //PLAN FOR CLOTH SETUP ON GPU:
    // 1: compute shader for each triangle (set of 3 indices) make 6 springs (each direction separately) set in buffer of array<Spring>
    //    makeSprings.cs.wgsl
    // 2: sort that array<Spring> by the index of the first spring, probably using a library
    // 3: compute shader for each vertex: set up particle data for that vertex in array<Particle>
    //    makeParticles.cs.wgsl
    // 4: compute shader for each spring: using atomics for firstSpringIdx and springCount, set those in the particle that has the first index in this spring
    //    addSpringToParticles.cs.wgsl
    //   IDK if fine to then use atomics when accessing these in clothSim.cs.wgsl itself but I think should be; otherwise has another pass that writes the result of the atomics to normal u32s
    // then run cloth sim
    //  in order to access neighbors iterate over [firstSpringIdx, firstSpringIdx+springCount) and that gives the other vertex index and rest length

    // TODO make compute pipeline to call those, add library for sort

    // TODO move to GPU
    for (let i = 0; i < this.vertexCount; ++i) {
      const x = input.vertices[i * stride];
      const z = input.vertices[i * stride + 2];

      const roundedX = Math.round(x * precisionFactor) / precisionFactor;
      const roundedZ = Math.round(z * precisionFactor) / precisionFactor;

      uniqueX.add(roundedX);
      uniqueZ.add(roundedZ);

      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }

    this.gridWidth = uniqueX.size;
    this.gridHeight = uniqueZ.size;

    console.log("Grid Dimensions: ", this.gridWidth, "x", this.gridHeight);

    this.spacingX = 0.125;
    this.spacingZ = 0.125;

    if (this.gridWidth > 1) {
      this.spacingX = (maxX - minX) / (this.gridWidth - 1);
    }

    if (this.gridHeight > 1) {
      this.spacingZ = (maxZ - minZ) / (this.gridHeight - 1);
    }

    console.log("spacing: ", this.spacingX, "x", this.spacingZ);

    const gridSizeBuffer = gpu.device.createBuffer({
      size: 8,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    gpu.device.queue.writeBuffer(
      gridSizeBuffer,
      0,
      new Uint32Array([this.gridWidth, this.gridHeight])
    );

    // Set up buffers.
    // Input buffers for verts and indices.
    const vertexBuffer = input.vertexBuffer;
    const indexBuffer = input.indexBuffer;

    console.log("ClothNode: incoming vertexBuffer", vertexBuffer);
    console.log("ClothNode: incoming vertex buffer size:", vertexBuffer?.size);

    // Instantiate time uniform buffer.
    this.timeUniformBuffer = gpu.device.createBuffer({
      label: "time uniform",
      size: 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Fill particle buffers.
    const particleCount = this.vertexCount;
    const cpuParticles = new ClothParticleCPU(particleCount);

    // Still using CPU vertices, TODO change to read from GPU vertex buffer evetually.
    // TODO move to GPU
    this.fillParticleBuffer(cpuParticles, input.vertices, this.vertexCount);

    // Ping-pong GPU buffers.
    this.particleBuffer1 = gpu.device.createBuffer({
      size: cpuParticles.buffer.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    this.particleBuffer2 = gpu.device.createBuffer({
      size: cpuParticles.buffer.byteLength,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Upload initial data to buffer1
    gpu.device.queue.writeBuffer(this.particleBuffer1, 0, cpuParticles.buffer);
    gpu.device.queue.writeBuffer(this.particleBuffer2, 0, cpuParticles.buffer);

    this.currentReadBuffer = this.particleBuffer1;
    this.currentWriteBuffer = this.particleBuffer2;

    // Output buffer for transformed vertices.
    if (
      !this.outputVertexBuffer ||
      this.outputVertexBuffer.size !== input.vertexBuffer!.size
    ) {
      this.outputVertexBuffer = gpu.device.createBuffer({
        label: "Cloth Sim Output Vertex Buffer",
        size: input.vertexBuffer!.size,
        usage:
          GPUBufferUsage.STORAGE |
          GPUBufferUsage.VERTEX |
          GPUBufferUsage.COPY_SRC,
      });
    }

    this.updateUniformBuffer();
    this.setupComputePipeline(gridSizeBuffer);

    // Invoke compute pass.
    // TODO: Update per frame for time uniform.
    // Change to invoking renderer to dispatch compute pass?
    // Done via updateSim and dispatchSim methods.

    // Debug.
    gpu.device.queue.onSubmittedWorkDone().then(async () => {
      const readBuffer = gpu.device.createBuffer({
        size: this.outputVertexBuffer.size,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });

      const enc = gpu.device.createCommandEncoder();
      enc.copyBufferToBuffer(
        this.outputVertexBuffer,
        0,
        readBuffer,
        0,
        this.outputVertexBuffer.size
      );
      gpu.device.queue.submit([enc.finish()]);

      await readBuffer.mapAsync(GPUMapMode.READ);
      const gpuVerts = new Float32Array(readBuffer.getMappedRange());
      console.log("[ClothNode.ts] GPU output vertices:", gpuVerts);
    });

    this.geometry = {
      // vertices: new Float32Array(input.vertices),
      // indices: new Uint32Array(input.indices),
      vertexBuffer: this.outputVertexBuffer,
      indexBuffer: indexBuffer,
      wireframeIndexBuffer: input.wireframeIndexBuffer,
      id: this.id,
      sourceId: input.sourceId ?? input.id,
      materialBuffer: input.materialBuffer,
    };

    return this.geometry;
  }

  // Fill particle buffer.
  fillParticleBuffer(
    clothPartBufferCPU: ClothParticleCPU,
    vertices: Float32Array,
    vertexCount: number
  ) {
    const stride = 8; // float count per vertex (vec4 + vec4)

    for (let i = 0; i < vertexCount; i++) {
      const base = i * stride;
      const pos = [vertices[base + 0], vertices[base + 1], vertices[base + 2]];

      if (i < 5) {
        console.log(`Particle ${i} initial pos:`, pos);
      }

      const gridX = i % this.gridWidth;
      const gridY = Math.floor(i / this.gridWidth);

      const isFixed = gridY === 0 ? 1 : 0; // this just pins the top edge ahahahahahahahaha

      clothPartBufferCPU.writeParticle(i, {
        position: pos,
        prevPosition: pos,
        velocity: [0, 0, 0], // initial
        mass: this.massControl.value,
        isFixed: isFixed,
      });
    }
  }

  isEdgePinned(vertexIndex: number, vertexCount: number) {
    // TODO: Implement pinned edge logic.
    return false;
  }

  updateUniformBuffer() {
    const gpu = GPUContext.getInstance();
    const spacingX = this.spacingX ?? 0.125;
    const spacingZ = this.spacingZ ?? 0.125;

    // Stiffness, mass, damping, gravity.
    const data = new Float32Array([
      this.stiffnessControl.value,
      this.massControl.value,
      this.dampingControl.value,
      this.gravityControl.value,
      spacingX,
      spacingZ,
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
  setupComputePipeline(gridSizeBuffer: GPUBuffer) {
    const gpu = GPUContext.getInstance();

    this.clothSimComputeBindGroupLayout = gpu.device.createBindGroupLayout({
      label: "cloth sim compute BGL",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        }, // input particles
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        }, // output particles
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        }, // output vertices
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        }, // cloth params
        {
          binding: 4,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        }, // delta time
        {
          binding: 5,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        }, // grid size
      ],
    });

    const shaderModule = gpu.device.createShaderModule({
      label: "cloth sim compute shader",
      code: clothSimComputeShader,
    });

    const pipelineLayout = gpu.device.createPipelineLayout({
      label: "cloth sim compute layout",
      bindGroupLayouts: [this.clothSimComputeBindGroupLayout],
    });

    this.clothSimComputePipeline = gpu.device.createComputePipeline({
      label: "cloth sim compute pipeline",
      layout: pipelineLayout,
      compute: { module: shaderModule, entryPoint: "main" },
    });

    this.gridSizeBuffer = gridSizeBuffer;

    console.log("ClothSimNode: compute shader loaded");
    console.log(
      "ClothSimNode: pipeline created:",
      this.clothSimComputePipeline
    );
  }

  // LOOKAT: Implement updateSim and dispatchSim methods from renderer.ts.
  public updateSim(deltaTime: number) {
    if (!this.timeUniformBuffer) return;

    this.updateUniformBuffer();

    // write deltaTime into uniform buffer (we use a Float32Array, buffer padded to 16 bytes)
    // const f32 = new Float32Array([deltaTime, 0, 0, 0]);
    // const gpu = GPUContext.getInstance();
    // gpu.device.queue.writeBuffer(this.timeUniformBuffer, 0, f32.buffer);

    // Updating delta time... converting ms to seconds
    const dtSeconds = Math.min(deltaTime / 1000.0, 0.016);
    const gpu = GPUContext.getInstance();
    gpu.device.queue.writeBuffer(
      this.timeUniformBuffer,
      0,
      new Float32Array([dtSeconds])
    );
  }

  public dispatchSim(pass: GPUComputePassEncoder) {
    if (!this.clothSimComputePipeline || !this.outputVertexBuffer) {
      console.log("ERROR: Compute resources not initialized.");
      return;
    }

    console.log("Dispatching cloth sim...");

    const gpu = GPUContext.getInstance();

    const bindGroup = gpu.device.createBindGroup({
      layout: this.clothSimComputeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.currentReadBuffer } },
        { binding: 1, resource: { buffer: this.currentWriteBuffer } },
        { binding: 2, resource: { buffer: this.outputVertexBuffer } },
        { binding: 3, resource: { buffer: this.clothSimUniformBuffer } },
        { binding: 4, resource: { buffer: this.timeUniformBuffer } },
        { binding: 5, resource: { buffer: this.gridSizeBuffer } },
      ],
    });

    pass.setPipeline(this.clothSimComputePipeline);
    pass.setBindGroup(0, bindGroup);

    const particleCount = this.currentReadBuffer.size / 64;
    const workgroups = Math.ceil(particleCount / this.workgroupSize);
    pass.dispatchWorkgroups(workgroups);

    [this.currentReadBuffer, this.currentWriteBuffer] = [
      this.currentWriteBuffer,
      this.currentReadBuffer,
    ];
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
