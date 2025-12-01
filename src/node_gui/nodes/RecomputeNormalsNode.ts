import { Node } from "./Node";
import { GeometryData, removeGeometry } from "../geometry/geometry";
import { NumberControl } from "../controls/NumberControl";
import { IGeometryModifier } from "../interfaces/NodeCapabilities";
import { IVertexDeformer } from "../interfaces/NodeCapabilities";
import { GPUContext } from "../../webgpu/GPUContext";
// Import recompute normals compute shader.
import recomputeNormalsComputeShader from '../../webgpu/shaders/recomputeNormals.cs.wgsl';

export class RecomputeNormalsNode
  extends Node
  implements IGeometryModifier {
  public inputGeometry?: GeometryData;

  deformationUniformBuffer?: GPUBuffer;

  // TODO rename?
  deformationComputeBindGroupLayout: GPUBindGroupLayout;
  deformationComputeBindGroup: GPUBindGroup;
  deformationComputePipeline: GPUComputePipeline;

  // Workgroup size.
  workgroupSize = 64;

  // TODO should handle vertices that are shared b/w triangles; rn just takes whatever happens to be computed latest
  // conceptually I can think of two ways:
  //  hard edges by copying vertices and doing each triangle separately
  //  soft edges by averaging the normal from each triangle?
  //    just realized also # of triangles per vertex can vary, so need to both add them all
  //  note in the case of cube want to do neither
  // I think in either case might need two passes? 
  //  for "soft" I think at least want two compute passes: one is compute normal for each triangle, convert to an integer form and atomic add them, and atomic add count of triangles per vertex, second is take those atomic results and convert back to float and divide by count of triangles
  //  for "hard" I'm not really sure how to go about but probably makes most sense to just have a pass that turns all of the vertices into copies per triangle then do a pass that finds the normals
  // TODO add controls for ways to handle vertices shared b/w triangles? harden/soften?


  constructor() {
    super("RecomputeNormals");

    this.ioBehavior.addGeometryInput();
    this.ioBehavior.addGeometryOutput();

    const onChange = () => {
      if (this.inputGeometry) {
        this.applyModification(this.inputGeometry);
      }
      this.updateBehavior.triggerUpdate();
    };

    

  }

  setInputGeometry(geometry: GeometryData) {
    this.inputGeometry = geometry;
    this.applyModification(this.inputGeometry);
  }

  applyModification(input: GeometryData): GeometryData | undefined {
    if (!input) return;

    const stride = 8 * 4; // 32 bytes to fit vec4 padding.
    const vertexCount = input.vertexBuffer!.size / stride;
    const indexCount = input.indexBuffer!.size / 4; // integers = 4 bytes

    // GPU stuffs.
    const gpu = GPUContext.getInstance();

    // Set up buffers.
    // Input buffers for verts and indices.
    const vertexBuffer = input.vertexBuffer;
    const indexBuffer = input.indexBuffer;

    console.log("RecomputeNormals: incoming vertexBuffer", vertexBuffer);
    console.log("RecomputeNormals: incoming vertex buffer size:", vertexBuffer?.size);

    // Output buffer for transformed vertices.
    const outputVertexBuffer = gpu.device.createBuffer({
      size: input.vertexBuffer!.size,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_SRC,
    });

    // this.updateUniformBuffer();
    this.setupComputePipeline(vertexBuffer!, outputVertexBuffer, indexBuffer!);

    // Invoke compute pass.
    const encoder = gpu.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.deformationComputePipeline);
    pass.setBindGroup(0, this.deformationComputeBindGroup);

    // operating per triangle; so vertexCount/3s
    const workgroups = Math.ceil(indexCount / 3 / this.workgroupSize);
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
    //   console.log("[RecomputeNormalsNode.ts] GPU output vertices:", gpuVerts);
    // });

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

  // updateUniformBuffer() {
  //   const gpu = GPUContext.getInstance();

  //   // strength, scale, seed, padding
  //   const data = new Float32Array([
  //     this.strengthControl.value,
  //     this.scaleControl.value,
  //     this.seedControl.value,
  //     this.modificationStyleControl.value,
  //   ]);

  //   if (!this.deformationUniformBuffer) {
  //     this.deformationUniformBuffer = gpu.device.createBuffer({
  //       size: data.byteLength,
  //       usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  //     });
  //   }

  //   gpu.device.queue.writeBuffer(this.deformationUniformBuffer, 0, data);
  // }

  // Pass in buffers for input vertices.
  setupComputePipeline(vertexBuffer: GPUBuffer, outputVertexBuffer: GPUBuffer, indexBuffer: GPUBuffer) {
    const gpu = GPUContext.getInstance();

    this.deformationComputeBindGroupLayout = gpu.device.createBindGroupLayout({
      label: "recompute normals compute BGL",
      entries: [
        { binding: 0, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        { binding: 1, visibility: GPUShaderStage.COMPUTE, buffer: { type: "storage" } },
        { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "read-only-storage" } },
        // { binding: 2, visibility: GPUShaderStage.COMPUTE, buffer: { type: "uniform" } },
      ]
    });

    let shaderModule = gpu.device.createShaderModule({
      label: "recompute normals compute shader",
      code: recomputeNormalsComputeShader,
    });


    const pipelineLayout = gpu.device.createPipelineLayout({
      label: "recompute normals compute layout",
      bindGroupLayouts: [this.deformationComputeBindGroupLayout]
    });

    this.deformationComputePipeline = gpu.device.createComputePipeline({
      label: "recompute normals compute pipeline",
      layout: pipelineLayout,
      compute: { module: shaderModule, entryPoint: "main" },
    });

    this.deformationComputeBindGroup = gpu.device.createBindGroup({
      layout: this.deformationComputeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: vertexBuffer } },
        { binding: 1, resource: { buffer: outputVertexBuffer } },
        { binding: 2, resource: { buffer: indexBuffer } },
        // { binding: 2, resource: { buffer: this.deformationUniformBuffer! } },
      ]
    });

    console.log("RecomputeNormalsNode: compute shader loaded");
    console.log("RecomputeNormalsNode: pipeline created:", this.deformationComputePipeline);
    console.log("RecomputeNormalsNode: bind group:", this.deformationComputeBindGroup);
  }


  async execute(inputs?: Record<string, any>) {
    const geom = inputs?.geometry?.[0] as GeometryData;
    if (!geom) {
      console.warn("RecomputeNormalsNode: No input geometry");
      return;
    }

    this.geometry = this.applyModification(geom);
    return { geometry: this.geometry };
  }

  getEditableControls() {
    return {
      
    };
  }
}
