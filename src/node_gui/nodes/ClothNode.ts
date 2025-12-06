"use strict";
import { Node } from "./Node";
import { GeometryData, removeGeometry } from "../geometry/geometry";
import { NumberControl } from "../controls/NumberControl";
import { IGeometryModifier } from "../interfaces/NodeCapabilities";
// Might need to add vertex deformer for cloth sim, but that on CPU.
import { GPUContext } from "../../webgpu/GPUContext";
// Import cloth compute shader.
import clothSimComputeShader from "../../webgpu/shaders/clothSim.cs.wgsl";
import makeSpringsComputeShader from "../../webgpu/shaders/makeSprings.cs.wgsl";
import makeParticlesComputeShader from "../../webgpu/shaders/makeParticles.cs.wgsl";
import addSpringsToParticlesComputeShader from "../../webgpu/shaders/addSpringsToParticles.cs.wgsl";
// Maybe we can change this to be more efficient structurally, but for now, call renderer.
import { Renderer } from "../../webgpu/renderer";
import { RadixSortKernel } from "webgpu-radix-sort";

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

  springBuffer: GPUBuffer;

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
    //    addSpringsToParticles.cs.wgsl
    //   IDK if fine to then use atomics when accessing these in clothSim.cs.wgsl itself but I think should be; otherwise has another pass that writes the result of the atomics to normal u32s
    // TODO I think actually need a 5th step: make version of particle w/o atomics, since want to not use atomics in clothSim.cs.wgsl. Or can the value just be reused from buffer?
    //    I don't know if just can pass data directly or if it's stored in different format; so if just these first 4 steps don't work might need to do that
    // ^ I think DON'T need to do that pass, it can read directly
    // then run cloth sim
    //  in order to access neighbors iterate over [firstSpringIdx, firstSpringIdx+springCount) and that gives the other vertex index and rest length


    // Set up buffers.
    // Input buffers for verts and indices.
    const vertexBuffer = input.vertexBuffer;
    const indexBuffer = input.indexBuffer;

    console.log("ClothNode: incoming vertexBuffer", vertexBuffer);
    console.log("ClothNode: incoming vertex buffer size:", vertexBuffer?.size);

    // rn this section contains the setup for the makeSprings (step 1) above; then sorting, then same thing for 3 (makeParticles) and 4 (addSpringsToParticles)
    // SPRING SETUP SECTION

    const vertexStride = 8 * 4; // 32 bytes to fit vec4 padding.
    const vertexCount = input.vertexBuffer!.size / vertexStride;
    const indexCount = input.indexBuffer!.size / 4; // integers = 4 bytes
    const springStride = 4 * 4; // 16 bytes for spring with padding.
    const triangleCount = indexCount / 3;
    const maxSpringCount = triangleCount * 3;
    
    // start makeSprings

    // Output buffer for created springs. <-- split into several buffers
    // Imported sorting pipeline seems restricted to sorting at most 32 bits at a time, so doing two passes to get each value sorted, then recombining
    // this.springBuffer = gpu.device.createBuffer({
    //   size: input.indexBuffer!.size * 4, // indexBuffer.size = 3*number of triangles = number of edges = number of springs -> each index 4 bytes -> each spring 16 bytes
    //   usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC, // TODO not sure usages right
    // });
    const outputSpringFirstParticleIndicesBuffer = gpu.device.createBuffer({
      size: input.indexBuffer!.size, 
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC, // TODO remove copy_src when done debugging
    });
    const outputSpringSecondParticleIndicesBuffer = gpu.device.createBuffer({
      size: input.indexBuffer!.size, 
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC, // TODO remove copy_src when done debugging
    });
    const outputSpringRestLengthBuffer = gpu.device.createBuffer({
      size: input.indexBuffer!.size, 
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC, // TODO remove copy_src when done debugging
    });

    const copySpringFirstParticleIndicesBuffer = gpu.device.createBuffer({
      size: input.indexBuffer!.size, 
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC, // TODO remove copy_src when done debugging
    });

    // set up compute pipeline
    let makeSpringsComputeBindGroupLayout = gpu.device.createBindGroupLayout({
      label: "make springs compute BGL",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
        {
          binding: 5,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
      ],
    });

    let shaderModule = gpu.device.createShaderModule({
      label: "make springs compute shader",
      code: makeSpringsComputeShader,
    });

    const pipelineLayout = gpu.device.createPipelineLayout({
      label: "make springs compute layout",
      bindGroupLayouts: [makeSpringsComputeBindGroupLayout],
    });

    let makeSpringsComputePipeline = gpu.device.createComputePipeline({
      label: "make springs compute pipeline",
      layout: pipelineLayout,
      compute: { module: shaderModule, entryPoint: "main" },
    });

    let makeSpringsComputeBindGroup = gpu.device.createBindGroup({
      layout: makeSpringsComputeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: vertexBuffer } },
        { binding: 1, resource: { buffer: indexBuffer } },
        { binding: 2, resource: { buffer: outputSpringFirstParticleIndicesBuffer } },
        { binding: 3, resource: { buffer: copySpringFirstParticleIndicesBuffer } },
        { binding: 4, resource: { buffer: outputSpringSecondParticleIndicesBuffer } },
        { binding: 5, resource: { buffer: outputSpringRestLengthBuffer } },
      ],
    });

    // Invoke compute pass.
    const encoder = gpu.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(makeSpringsComputePipeline);
    pass.setBindGroup(0, makeSpringsComputeBindGroup);

    // operating per triangle; so indexCount/3s
    const makeSpringsWorkgroups = Math.ceil(indexCount / 3 / this.workgroupSize);
    pass.dispatchWorkgroups(makeSpringsWorkgroups);

    // pass.end();
    // gpu.device.queue.submit([encoder.finish()]);


    
    // encoder.copyBufferToBuffer(outputSpringFirstParticleIndicesBuffer, 0, copySpringFirstParticleIndicesBuffer, 0, outputSpringSecondParticleIndicesBuffer.size);
    


    // Sort springs by particleIdx0
    const radixSortKernel = new RadixSortKernel({
      device: gpu.device,                   // GPUDevice to use
      keys: outputSpringFirstParticleIndicesBuffer,                 // GPUBuffer containing the keys to sort
      values: outputSpringSecondParticleIndicesBuffer,             // (optional) GPUBuffer containing the associated values
      count: outputSpringFirstParticleIndicesBuffer.size / 4,               // Number of elements to sort
      check_order: false,               // Whether to check if the input is already sorted to exit early
      bit_count: 32,                    // Number of bits per element. Must be a multiple of 4 (default: 32)
      workgroup_size: { x: 16, y: 16 }, // Workgroup size in x and y dimensions. (x * y) must be a power of two
    });

    radixSortKernel.dispatch(pass); // Sort keysBuffer and valuesBuffer in-place on the GPU


    const radixSortKernel2 = new RadixSortKernel({
      device: gpu.device,                   // GPUDevice to use
      keys: copySpringFirstParticleIndicesBuffer,                 // GPUBuffer containing the keys to sort
      values: outputSpringRestLengthBuffer,             // (optional) GPUBuffer containing the associated values
      count: copySpringFirstParticleIndicesBuffer.size / 4,               // Number of elements to sort
      check_order: false,               // Whether to check if the input is already sorted to exit early
      bit_count: 32,                    // Number of bits per element. Must be a multiple of 4 (default: 32)
      workgroup_size: { x: 16, y: 16 }, // Workgroup size in x and y dimensions. (x * y) must be a power of two
    });

    radixSortKernel2.dispatch(pass); // Sort keysBuffer and valuesBuffer in-place on the GPU








    // start makeParticles
    this.updateUniformBuffer();



    const outputParticleBuffer = gpu.device.createBuffer({
      size: vertexCount * 64, 
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC, // TODO remove COPY_SRC if not needed after debug
    });

    // set up compute pipeline
    let makeParticlesComputeBindGroupLayout = gpu.device.createBindGroupLayout({
      label: "make particles compute BGL",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
      ],
    });

    let makeParticlesShaderModule = gpu.device.createShaderModule({
      label: "make particles compute shader",
      code: makeParticlesComputeShader,
    });

    const makeParticlesPipelineLayout = gpu.device.createPipelineLayout({
      label: "make particles compute layout",
      bindGroupLayouts: [makeParticlesComputeBindGroupLayout],
    });

    let makeParticlesComputePipeline = gpu.device.createComputePipeline({
      label: "make particles compute pipeline",
      layout: makeParticlesPipelineLayout,
      compute: { module: makeParticlesShaderModule, entryPoint: "main" },
    });

    let makeParticlesComputeBindGroup = gpu.device.createBindGroup({
      layout: makeParticlesComputeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: vertexBuffer } },
        { binding: 1, resource: { buffer: outputParticleBuffer } },
        { binding: 2, resource: { buffer: this.clothSimUniformBuffer } },
      ],
    });


    pass.setPipeline(makeParticlesComputePipeline);
    pass.setBindGroup(0, makeParticlesComputeBindGroup);


    const makeParticlesWorkgroups = Math.ceil(vertexCount / this.workgroupSize);
    pass.dispatchWorkgroups(makeParticlesWorkgroups);
  
    
    
    
    
    // start addSpringsToParticles


    this.springBuffer = gpu.device.createBuffer({
      size: maxSpringCount * 16, 
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC, // TODO remove COPY_SRC if not needed after debug
    });

    // set up compute pipeline
    let addSpringsToParticlesComputeBindGroupLayout = gpu.device.createBindGroupLayout({
      label: "add springs to particles compute BGL",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
      ],
    });

    let addSpringsToParticlesShaderModule = gpu.device.createShaderModule({
      label: "add springs to particles compute shader",
      code: addSpringsToParticlesComputeShader,
    });

    const addSpringsToParticlesPipelineLayout = gpu.device.createPipelineLayout({
      label: "add springs to particles compute layout",
      bindGroupLayouts: [addSpringsToParticlesComputeBindGroupLayout],
    });

    let addSpringsToParticlesComputePipeline = gpu.device.createComputePipeline({
      label: "add springs to particles compute pipeline",
      layout: addSpringsToParticlesPipelineLayout,
      compute: { module: addSpringsToParticlesShaderModule, entryPoint: "main" },
    });

    let addSpringsToParticlesComputeBindGroup = gpu.device.createBindGroup({
      layout: addSpringsToParticlesComputeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: outputSpringFirstParticleIndicesBuffer } },
        { binding: 1, resource: { buffer: outputSpringSecondParticleIndicesBuffer } },
        { binding: 2, resource: { buffer: outputSpringRestLengthBuffer } },
        { binding: 3, resource: { buffer: outputParticleBuffer } },
        { binding: 4, resource: { buffer: this.springBuffer } },
      ],
    });


    pass.setPipeline(addSpringsToParticlesComputePipeline);
    pass.setBindGroup(0, addSpringsToParticlesComputeBindGroup);


    const addSpringsToParticlesWorkgroups = Math.ceil(maxSpringCount / this.workgroupSize);
    pass.dispatchWorkgroups(addSpringsToParticlesWorkgroups);
  
    
    
    
    

    pass.end();
    gpu.device.queue.submit([encoder.finish()]);

    // Debug.
    // gpu.device.queue.onSubmittedWorkDone().then(async () => {
    //   const readBuffer = gpu.device.createBuffer({
    //     size: outputParticleBuffer.size,
    //     usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    //   });

    //   const enc = gpu.device.createCommandEncoder();
    //   enc.copyBufferToBuffer(
    //     outputParticleBuffer,
    //     0,
    //     readBuffer,
    //     0,
    //     outputParticleBuffer.size
    //   );
    //   gpu.device.queue.submit([enc.finish()]);

    //   await readBuffer.mapAsync(GPUMapMode.READ);
    //   const gpuSprings = new Uint32Array(readBuffer.getMappedRange());
    //   console.log("[ClothNode.ts] Output particles:", gpuSprings);
    // });
        
    // SPRING SETUP SECTION END



    
    // TODO move to GPU
    // Instantiate time uniform buffer.
    this.timeUniformBuffer = gpu.device.createBuffer({
      label: "time uniform",
      size: 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Ping-pong GPU buffers.
    this.particleBuffer1 = outputParticleBuffer

    this.particleBuffer2 = gpu.device.createBuffer({
      size: outputParticleBuffer.size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Upload initial data to buffer1
    // gpu.device.queue.writeBuffer(this.particleBuffer1, 0, cpuParticles.buffer);
    // gpu.device.queue.writeBuffer(this.particleBuffer2, 0, cpuParticles.buffer);
    const enc = gpu.device.createCommandEncoder();
    enc.copyBufferToBuffer(
      this.particleBuffer1,
      0,
      this.particleBuffer2,
      0,
      this.particleBuffer1.size
    );
    gpu.device.queue.submit([enc.finish()]);

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

    
    this.setupComputePipeline();

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
  setupComputePipeline() {
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
          buffer: { type: "read-only-storage" },
        }, // input springs
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

    const gpu = GPUContext.getInstance();

    const bindGroup = gpu.device.createBindGroup({
      layout: this.clothSimComputeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.currentReadBuffer } },
        { binding: 1, resource: { buffer: this.currentWriteBuffer } },
        { binding: 2, resource: { buffer: this.outputVertexBuffer } },
        { binding: 3, resource: { buffer: this.clothSimUniformBuffer } },
        { binding: 4, resource: { buffer: this.timeUniformBuffer } },
        { binding: 5, resource: { buffer: this.springBuffer } },
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
