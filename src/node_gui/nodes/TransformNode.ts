// src/components/nodes/NodeB.ts
import { Node } from "./Node";
import { GeometryData } from "../geometry/geometry";
import { Vec3Control } from "../controls/Vec3Control";
import { IGeometryModifier } from "../interfaces/NodeCapabilities";
import { Vec3 } from "../controls/Vec3Control";
import { GPUContext } from "../../webgpu/GPUContext";
// Import transform compute shader.
import transformComputeShader from '../../webgpu/shaders/transform.cs.wgsl';

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
    super("TransformNode");

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

    const transformed = this.transformVertices(
      input.vertices,
      this.translation.value,
      this.rotation.value,
      this.scale.value
    );

    // TODO: Pass in vertex + index buffer from primitive node: input.vertexBuffer, input.indexBuffer
    // NOTE: the division by 3 only applies if verts only contains positions.
    const vertexCount = input.vertices.length / 3;

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

    // TODO: Invoke compute shader.
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

    this.geometry = {
      vertices: transformed,
      indices: new Uint32Array(input.indices),
      // TODO set vertexBuffer and indexBuffer (eventually, remove .vertices and .indices^)
      vertexBuffer: outputVertexBuffer,
      indexBuffer: indexBuffer,
      id: this.id,
      sourceId: input.sourceId ?? input.id,
    };

    if (this.geometry.vertices == this.inputGeometry.vertices) {
      console.warn(
        "TransformNode: Input geometry and output using same vertex array"
      );
    }

    return this.geometry;
  }

  updateUniformBuffer() {
    const gpu = GPUContext.getInstance();
    const data = new Float32Array([
      this.translation.value.x, this.translation.value.y, this.translation.value.z, 0,
      this.rotation.value.x, this.rotation.value.y, this.rotation.value.z, 0,
      this.scale.value.x, this.scale.value.y, this.scale.value.z, 0
    ]);

    if (!this.transformUniformBuffer) {
      this.transformUniformBuffer = gpu.device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    }
    gpu.device.queue.writeBuffer(this.transformUniformBuffer, 0, data);
  }

  // TODO: create bindgroups and compute pipeline to pass into compute shader.
  // Pass in buffers for input vertices.
  setupComputePipeline(vertexBuffer: GPUBuffer, outputVertexBuffer: GPUBuffer) {
    const gpu = GPUContext.getInstance();

    this.transformComputeBindGroupLayout = gpu.device.createBindGroupLayout({
      label: "transform compute BGL",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      ]
    });

    const shaderModule = gpu.device.createShaderModule({
      label: "transform compute shader",
      code: transformComputeShader,
    });

    const pipelineLayout = gpu.device.createPipelineLayout({
      label: "transform compute layout",
      bindGroupLayouts: [this.transformComputeBindGroupLayout]
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
      ]
    });

    console.log("TransformNode: compute shader loaded");
    console.log("TransformNode: pipeline created:", this.transformComputePipeline);
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

  private transformVertices(
    vertices: Float32Array,
    translation: Vec3,
    rotation: Vec3,
    scale: Vec3
  ): Float32Array {
    const transformed = new Float32Array(vertices.length);
    const rx = (rotation.x * Math.PI) / 180;
    const ry = (rotation.y * Math.PI) / 180;
    const rz = (rotation.z * Math.PI) / 180;

    const sx = Math.sin(rx),
      cx = Math.cos(rx);
    const sy = Math.sin(ry),
      cy = Math.cos(ry);
    const sz = Math.sin(rz),
      cz = Math.cos(rz);

    for (let i = 0; i < vertices.length; i += 3) {
      let x = vertices[i] * scale.x;
      let y = vertices[i + 1] * scale.y;
      let z = vertices[i + 2] * scale.z;

      let y1 = y * cx - z * sx;
      let z1 = y * sx + z * cx;
      let x2 = x * cy + z1 * sy;
      let z2 = -x * sy + z1 * cy;
      let x3 = x2 * cz - y1 * sz;
      let y3 = x2 * sz + y1 * cz;

      transformed[i] = x3 + translation.x;
      transformed[i + 1] = y3 + translation.y;
      transformed[i + 2] = z2 + translation.z;
    }

    return transformed;
  }

  getEditableControls() {
    return {
      translation: this.translation,
      rotation: this.rotation,
      scale: this.scale,
    };
  }
}
