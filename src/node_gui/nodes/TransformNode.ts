import { Node } from "./Node";
import { GeometryData } from "../geometry/geometry";
import { Vec3Control } from "../controls/Vec3Control";
import { IGeometryModifier } from "../interfaces/NodeCapabilities";
import { Vec3 } from "../controls/Vec3Control";
import { GPUContext } from "../../webgpu/GPUContext";
// Import transform compute shader.
import transformComputeShader from "../../webgpu/shaders/transform.cs.wgsl";

export class TransformNode extends Node implements IGeometryModifier {
  translation: Vec3Control;
  rotation: Vec3Control;
  scale: Vec3Control;

  public inputGeometry?: GeometryData;

  transformUniformBuffer?: GPUBuffer;

  transformComputeBindGroupLayout: GPUBindGroupLayout;
  transformComputeBindGroup: GPUBindGroup;
  transformComputePipeline: GPUComputePipeline;

  // Workgroup size.
  workgroupSize = 64;

  constructor() {
    super("Transform");

    this.ioBehavior.addGeometryInput();
    this.ioBehavior.addGeometryOutput();

    // Handler when controls change
    const onChange = () => {
      if (this.inputGeometry) {
        this.applyModification(this.inputGeometry);
      }
      this.updateBehavior.triggerUpdate();
    };

    this.translation = new Vec3Control(
      "Translation",
      { x: 0, y: 0, z: 0 },
      onChange
    );

    this.rotation = new Vec3Control(
      "Rotation",
      { x: 0, y: 0, z: 0 },
      onChange,
      5
    );

    this.scale = new Vec3Control("Scale", { x: 1, y: 1, z: 1 }, onChange); // default 1 for scale
  }

  setInputGeometry(geometry: GeometryData) {
    this.inputGeometry = geometry;
    this.applyModification(this.inputGeometry);
  }

  applyModification(input: GeometryData): GeometryData | undefined {
    if (!input) return;
    // TODO once operating on GPU-side, probably make this.outputEnabled into more of a passthrough:
    //  that is, here check:
    //  if (this.outputEnabled) {
    //    ... // do this transformation
    //  } else {
    //   use copyBufferToBuffer to copy inputGeometry vertex/index buffers directly to output
    //  }

    const vertexCount = input.vertexBuffer!.size / (8 * 4);

    // GPU stuffs.
    const gpu = GPUContext.getInstance();

    // Set up buffers.
    // Input buffers for verts and indices.
    const vertexBuffer = input.vertexBuffer;
    const indexBuffer = input.indexBuffer;

    console.log("TransformNode: incoming vertexBuffer", vertexBuffer);
    console.log(
      "TransformNode: incoming vertex buffer size:",
      vertexBuffer?.size
    );

    // Output buffer for transformed vertices.
    const outputVertexBuffer = gpu.device.createBuffer({
      size: input.vertexBuffer!.size,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.VERTEX |
        GPUBufferUsage.COPY_SRC,
    });

    this.updateUniformBuffer();
    this.setupComputePipeline(vertexBuffer!, outputVertexBuffer);

    // Invoke compute pass.
    const encoder = gpu.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.transformComputePipeline);
    pass.setBindGroup(0, this.transformComputeBindGroup);

    const workgroups = Math.ceil(vertexCount / this.workgroupSize);
    pass.dispatchWorkgroups(workgroups);

    pass.end();
    gpu.device.queue.submit([encoder.finish()]);

    // Debug.
    // gpu.device.queue.onSubmittedWorkDone().then(async () => {
    //   const readBuffer = gpu.device.createBuffer({
    //     size: outputVertexBuffer.size,
    //     usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    //   });

    //   const enc = gpu.device.createCommandEncoder();
    //   enc.copyBufferToBuffer(
    //     outputVertexBuffer,
    //     0,
    //     readBuffer,
    //     0,
    //     outputVertexBuffer.size
    //   );
    //   gpu.device.queue.submit([enc.finish()]);

    //   await readBuffer.mapAsync(GPUMapMode.READ);
    //   const gpuVerts = new Float32Array(readBuffer.getMappedRange());
    //   console.log("[TransformNode.ts] GPU output vertices:", gpuVerts);
    // });

    this.geometry = {
      vertexBuffer: outputVertexBuffer,
      indexBuffer: indexBuffer,
      wireframeIndexBuffer: input.wireframeIndexBuffer, // I think doesn't need to copy?
      id: this.id,
      sourceId: input.sourceId ?? input.id,
      materialBuffer: input.materialBuffer,
    };

    // if (this.geometry.vertices == this.inputGeometry.vertices) {
    //   console.warn(
    //     "TransformNode: Input geometry and output using same vertex array"
    //   );
    // }

    return this.geometry;
  }

  updateUniformBuffer() {
    const gpu = GPUContext.getInstance();
    const data = new Float32Array([
      this.translation.value.x,
      this.translation.value.y,
      this.translation.value.z,
      0,
      this.rotation.value.x,
      this.rotation.value.y,
      this.rotation.value.z,
      0,
      this.scale.value.x,
      this.scale.value.y,
      this.scale.value.z,
      0,
    ]);

    if (!this.transformUniformBuffer) {
      this.transformUniformBuffer = gpu.device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    }
    gpu.device.queue.writeBuffer(this.transformUniformBuffer, 0, data);
  }

  // Pass in buffers for input vertices.
  setupComputePipeline(vertexBuffer: GPUBuffer, outputVertexBuffer: GPUBuffer) {
    const gpu = GPUContext.getInstance();

    this.transformComputeBindGroupLayout = gpu.device.createBindGroupLayout({
      label: "transform compute BGL",
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

    const shaderModule = gpu.device.createShaderModule({
      label: "transform compute shader",
      code: transformComputeShader,
    });

    const pipelineLayout = gpu.device.createPipelineLayout({
      label: "transform compute layout",
      bindGroupLayouts: [this.transformComputeBindGroupLayout],
    });

    this.transformComputePipeline = gpu.device.createComputePipeline({
      label: "transform compute pipeline",
      layout: pipelineLayout,
      compute: { module: shaderModule, entryPoint: "main" },
    });

    this.transformComputeBindGroup = gpu.device.createBindGroup({
      layout: this.transformComputeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: vertexBuffer } },
        { binding: 1, resource: { buffer: outputVertexBuffer } },
        { binding: 2, resource: { buffer: this.transformUniformBuffer! } },
      ],
    });

    console.log("TransformNode: compute shader loaded");
    console.log(
      "TransformNode: pipeline created:",
      this.transformComputePipeline
    );
    console.log("TransformNode: bind group:", this.transformComputeBindGroup);
  }

  async execute(inputs?: Record<string, any>) {
    const geom = inputs?.geometry?.[0] as GeometryData;
    if (!geom) {
      console.warn("TransformNode: No input geometry");
      return;
    }

    this.geometry = this.applyModification(geom);
    return { geometry: this.geometry };
  }

  getEditableControls() {
    return {
      translation: this.translation,
      rotation: this.rotation,
      scale: this.scale,
    };
  }
}
