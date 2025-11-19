import {
  onNewGeometry,
  onGeometryRemoved,
  getGeometries,
  addRebuildSubscriber,
} from "../node_gui/geometry/geometry";
import { GPUContext } from "./GPUContext";

export class SceneManager {
  public vertexBuffer?: GPUBuffer;
  public indexBuffer?: GPUBuffer;
  public indexCount: number = 0;

  private gpu: GPUContext;

  constructor() {
    this.gpu = GPUContext.getInstance();

    // Bind events to rebuild buffers when geometry changes
    onNewGeometry(() => this.rebuildBuffers());
    onGeometryRemoved(() => this.rebuildBuffers());
    addRebuildSubscriber(() => this.rebuildBuffers());

    // Initial build
    this.rebuildBuffers();
  }

  private rebuildBuffers() {
    const geometries = getGeometries();
    if (geometries.length === 0) {
      this.indexCount = 0;
      return;
    }

    let totalVertices: number[] = [];
    let totalIndices: number[] = [];
    let vertexOffset = 0;

    // Flatten all geometries into one batch (Batch Rendering)
    for (const geom of geometries) {
      // TODO I think the ... might stop working at large sizes of arrays (issue we had with icosphere earlier) so make if getting a crash type of error w/ lots of geometry later might be the cause
      totalVertices.push(...Array.from(geom.vertices)); 

      // Offset indices so they point to the correct vertices in the merged buffer
      for (let i = 0; i < geom.indices.length; i++) {
        totalIndices.push(geom.indices[i] + vertexOffset);
      }

      vertexOffset += geom.vertices.length / 3;
    }

    const vertexData = new Float32Array(totalVertices);
    const indexData = new Uint32Array(totalIndices);
    this.indexCount = indexData.length;

    // Create Buffers
    // optimization: In a real app, you wouldn't destroy/create every frame,
    // you would create a large buffer and write into it.
    this.vertexBuffer = this.gpu.device.createBuffer({
      size: Math.max(vertexData.byteLength, 32), // Min size safety
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    });
    this.gpu.device.queue.writeBuffer(this.vertexBuffer, 0, vertexData.buffer);

    this.indexBuffer = this.gpu.device.createBuffer({
      size: Math.max(indexData.byteLength, 32),
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.gpu.device.queue.writeBuffer(this.indexBuffer, 0, indexData.buffer);

    console.log(
      `Scene updated: ${geometries.length} objects, ${this.indexCount} indices`
    );
  }
}
