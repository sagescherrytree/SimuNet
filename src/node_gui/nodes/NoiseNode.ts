import { Node } from "./Node";
import { GeometryData, removeGeometry } from "../geometry/geometry";
import { NumberControl } from "../controls/NumberControl";
import { IGeometryModifier } from "../interfaces/NodeCapabilities";
import { IVertexDeformer } from "../interfaces/NodeCapabilities";
import { GPUContext } from "../../webgpu/GPUContext";
// Import noise compute shader.
import noiseComputeShader from '../../webgpu/shaders/noise.cs.wgsl';
import fbmNoiseComputeShader from '../../webgpu/shaders/fbmNoise.cs.wgsl';
import worleyNoiseComputeShader from '../../webgpu/shaders/worleyNoise.cs.wgsl';

export class NoiseNode
  extends Node
  implements IGeometryModifier, IVertexDeformer {
  public inputGeometry?: GeometryData;

  deformationUniformBuffer?: GPUBuffer;

  deformationComputeBindGroupLayout: GPUBindGroupLayout;
  deformationComputeBindGroup: GPUBindGroup;
  deformationComputePipeline: GPUComputePipeline;

  // Workgroup size.
  workgroupSize = 64;

  strengthControl: NumberControl;
  scaleControl: NumberControl;
  seedControl: NumberControl;

  // TODO better control--dropdown? need to setup
  noiseStyleControl: NumberControl;
  modificationStyleControl: NumberControl;
  
  constructor() {
    super("NoiseNode");

    this.ioBehavior.addGeometryInput();
    this.ioBehavior.addGeometryOutput();

    const onChange = () => {
      if (this.inputGeometry) {
        this.applyModification(this.inputGeometry);
      }
      this.updateBehavior.triggerUpdate();
    };

    this.strengthControl = new NumberControl("Strength", 0.5, onChange, 0.1);
    this.scaleControl = new NumberControl("Scale", 1.0, onChange, 0.1);
    this.seedControl = new NumberControl("Seed", 0, onChange, 1, 0, 1000);
    this.noiseStyleControl = new NumberControl("Noise Type", 0, onChange, 1, 0, 2);
    this.modificationStyleControl = new NumberControl("Transformation Type", 0, onChange, 1, 0, 1);
    

  }

  setInputGeometry(geometry: GeometryData) {
    this.inputGeometry = geometry;
    this.applyModification(this.inputGeometry);
  }

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

    console.log("TransformNode: incoming vertexBuffer", vertexBuffer);
    console.log("TransformNode: incoming vertex buffer size:", vertexBuffer?.size);

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
    pass.setPipeline(this.deformationComputePipeline);
    pass.setBindGroup(0, this.deformationComputeBindGroup);

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
      console.log("[NoiseNode.ts] GPU output vertices:", gpuVerts);
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
      materialBuffer: input.materialBuffer
    };

    return this.geometry;
  }

  updateUniformBuffer() {
    const gpu = GPUContext.getInstance();

    // strength, scale, seed, padding
    const data = new Float32Array([
      this.strengthControl.value,
      this.scaleControl.value,
      this.seedControl.value,
      this.modificationStyleControl.value,
    ]);

    if (!this.deformationUniformBuffer) {
      this.deformationUniformBuffer = gpu.device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    }

    gpu.device.queue.writeBuffer(this.deformationUniformBuffer, 0, data);
  }

  // Pass in buffers for input vertices.
  setupComputePipeline(vertexBuffer: GPUBuffer, outputVertexBuffer: GPUBuffer) {
    const gpu = GPUContext.getInstance();

    this.deformationComputeBindGroupLayout = gpu.device.createBindGroupLayout({
      label: "noise deformation compute BGL",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      ]
    });

    let shaderModule;
    if (this.noiseStyleControl.value === 1) {
      shaderModule = gpu.device.createShaderModule({
        label: "worley noise deformation compute shader",
        code: worleyNoiseComputeShader,
      });
      console.log(shaderModule);
    } else if (this.noiseStyleControl.value === 2) {
      shaderModule = gpu.device.createShaderModule({
        label: "fbm noise deformation compute shader",
        code: fbmNoiseComputeShader,
      });
    } else {
      shaderModule = gpu.device.createShaderModule({
        label: "basic noise deformation compute shader",
        code: noiseComputeShader,
      });
    }

    const pipelineLayout = gpu.device.createPipelineLayout({
      label: "noise deformation compute layout",
      bindGroupLayouts: [this.deformationComputeBindGroupLayout]
    });

    this.deformationComputePipeline = gpu.device.createComputePipeline({
      label: "noise deformation compute pipeline",
      layout: pipelineLayout,
      compute: { module: shaderModule, entryPoint: "main" },
    });

    this.deformationComputeBindGroup = gpu.device.createBindGroup({
      layout: this.deformationComputeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: vertexBuffer } },
        { binding: 1, resource: { buffer: outputVertexBuffer } },
        { binding: 2, resource: { buffer: this.deformationUniformBuffer! } },
      ]
    });

    console.log("NoiseNode: compute shader loaded");
    console.log("NoiseNode: pipeline created:", this.deformationComputePipeline);
    console.log("NoiseNode: bind group:", this.deformationComputeBindGroup);
  }


  deformVertices(vertices: Float32Array): Float32Array {
    const deformed = new Float32Array(vertices.length);
    const strength = this.strengthControl.value ?? 0.5;
    const scale = this.scaleControl.value ?? 1.0;
    const seed = this.seedControl.value ?? 0;

    for (let i = 0; i < vertices.length; i += 3) {
      const x = vertices[i];
      const y = vertices[i + 1];
      const z = vertices[i + 2];

      const noise = this.simpleNoise(x * scale + seed, y * scale, z * scale);

      const len = Math.sqrt(x * x + y * y + z * z) || 1;
      const nx = x / len,
        ny = y / len,
        nz = z / len;

      deformed[i] = x + nx * noise * strength;
      deformed[i + 1] = y + ny * noise * strength;
      deformed[i + 2] = z + nz * noise * strength;
    }

    return deformed;
  }

  private simpleNoise(x: number, y: number, z: number): number {
    return Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 0.5 + 0.5;
  }

  async execute(inputs?: Record<string, any>) {
    const geom = inputs?.geometry?.[0] as GeometryData;
    if (!geom) {
      console.warn("NoiseNode: No input geometry");
      return;
    }

    this.geometry = this.applyModification(geom);
    return { geometry: this.geometry };
  }

  getEditableControls() {
    return {
      strength: this.strengthControl,
      scale: this.scaleControl,
      seed: this.seedControl,
      noiseStyle: this.noiseStyleControl,
      modificationStyle: this.modificationStyleControl,
    };
  }
}
