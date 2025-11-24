import {
  onNewGeometry,
  onGeometryRemoved,
  getGeometries,
  addRebuildSubscriber,
} from "../node_gui/geometry/geometry";
import { GPUContext } from "./GPUContext";
import { vec3, Vec3 } from "wgpu-matrix";
import { GeometryData } from "../node_gui/geometry/geometry";

export class SceneManager {
  public vertexBuffer?: GPUBuffer;
  public indexBuffer?: GPUBuffer;
  public wireframeIndexBuffer?: GPUBuffer;

  public indexCount: number = 0;
  public wireframeIndexCount: number = 0;

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

  // Fallback function in case there are no wireframes in the geometry node itself
  // Done so that wireframes aren't regenerated on each scene rebuild, only when geometry actually changes
  private generateWireframeIndices(triangleIndices: Uint32Array): Uint32Array {
    const edges = new Set<string>();
    const lineIndices: number[] = [];

    // For each triangle, add its 3 edges
    for (let i = 0; i < triangleIndices.length; i += 3) {
      const i0 = triangleIndices[i];
      const i1 = triangleIndices[i + 1];
      const i2 = triangleIndices[i + 2];

      // Create edges (using sorted pairs to avoid duplicates)
      const edge1 = `${Math.min(i0, i1)}-${Math.max(i0, i1)}`;
      const edge2 = `${Math.min(i1, i2)}-${Math.max(i1, i2)}`;
      const edge3 = `${Math.min(i2, i0)}-${Math.max(i2, i0)}`;

      if (!edges.has(edge1)) {
        edges.add(edge1);
        lineIndices.push(i0, i1);
      }
      if (!edges.has(edge2)) {
        edges.add(edge2);
        lineIndices.push(i1, i2);
      }
      if (!edges.has(edge3)) {
        edges.add(edge3);
        lineIndices.push(i2, i0);
      }
    }

    return new Uint32Array(lineIndices);
  }

  private rebuildBuffers() {
    const geometries = getGeometries();
    if (geometries.length === 0) {
      this.indexCount = 0;
      this.wireframeIndexCount = 0;
      return;
    }

    //Planning note:
    // I think just need to iterate through the vertex/index buffers, 
    // get total length, make a buffer of that length, copy data

    let totalVertices: number[] = [];
    let totalIndices: number[] = [];
    let totalWireframeIndices: number[] = [];
    let vertexOffset = 0;

    let totalBufferSizes: number[] = geometries.reduce((result, geom) => {
      if (geom.vertexBuffer && geom.indexBuffer) {
        result[0] += geom.vertexBuffer.size;
        result[1] += geom.indexBuffer.size;
      }
      return result;
    }, [0, 0]);

    this.vertexBuffer = this.gpu.device.createBuffer({
      size: Math.max(totalBufferSizes[0], 32), // Min size safety
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC, // TODO change usage back
    });

    this.indexBuffer = this.gpu.device.createBuffer({
      size: Math.max(totalBufferSizes[1], 32),
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
    });

    const encoder = this.gpu.device.createCommandEncoder();

    let vertexBufferOffset = 0;
    let indexBufferOffset = 0;
    for (const geom of geometries) {
      if (geom.vertexBuffer && geom.indexBuffer) {
        encoder.copyBufferToBuffer(geom.vertexBuffer, 0, this.vertexBuffer, vertexBufferOffset, geom.vertexBuffer.size);
        encoder.copyBufferToBuffer(geom.indexBuffer, 0, this.indexBuffer, indexBufferOffset, geom.indexBuffer.size);
        vertexBufferOffset += geom.vertexBuffer.size;
        indexBufferOffset += geom.indexBuffer.size;
        console.log("wrote geometry:");
        console.log(geom);
        console.log("buffers written up to VB: " + vertexBufferOffset + " IB: " + indexBufferOffset);
      } else {
        console.log("No buffers found for geometry:");
        console.log(geom);
      }
    }

    this.gpu.device.queue.submit([encoder.finish()]);

    // Debug.
    this.gpu.device.queue.onSubmittedWorkDone().then(async () => {

      if (geometries.length > 0) {
        const vertexReadBuffer = this.gpu.device.createBuffer({
          size: this.vertexBuffer.size,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });
        const indexReadBuffer = this.gpu.device.createBuffer({
          size: this.indexBuffer.size,
          usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
        });

        const enc = this.gpu.device.createCommandEncoder();
        enc.copyBufferToBuffer(
          this.vertexBuffer,
          0,
          vertexReadBuffer,
          0,
          this.vertexBuffer.size
        );
        enc.copyBufferToBuffer(
          this.indexBuffer,
          0,
          indexReadBuffer,
          0,
          this.indexBuffer.size
        );
        this.gpu.device.queue.submit([enc.finish()]);

        await vertexReadBuffer.mapAsync(GPUMapMode.READ);
        await indexReadBuffer.mapAsync(GPUMapMode.READ);
        const gpuVerts = new Float32Array(vertexReadBuffer.getMappedRange());
        const gpuIndices = new Uint32Array(indexReadBuffer.getMappedRange());
        console.log("[SceneManager.ts] GPU output vertices:", gpuVerts);
        console.log("[SceneManager.ts] GPU output indices:", gpuIndices);
      }
    });



    // TODO make wireframe on GPU-side and replace this
    // Flatten all geometries into one batch (Batch Rendering)
    for (const geom of geometries) {
      const vertexCount = geom.vertices.length / 3;
      const normalData = geom.normals || new Float32Array(geom.vertices.length);

      for (let i = 0; i < vertexCount; i++) {
        const vIndex = i * 3;

        totalVertices.push(
          geom.vertices[vIndex],
          geom.vertices[vIndex + 1],
          geom.vertices[vIndex + 2]
        );

        totalVertices.push(
          normalData[vIndex],
          normalData[vIndex + 1],
          normalData[vIndex + 2]
        );
      }

      // Offset indices so they point to the correct vertices in the merged buffer
      for (let i = 0; i < geom.indices.length; i++) {
        totalIndices.push(geom.indices[i] + vertexOffset);
      }

      const wireframeForGeom =
        geom.wireframeIndices || this.generateWireframeIndices(geom.indices);
      for (let i = 0; i < wireframeForGeom.length; i++) {
        totalWireframeIndices.push(wireframeForGeom[i] + vertexOffset);
      }

      vertexOffset += geom.vertices.length / 3;
    }

    const vertexData = new Float32Array(totalVertices);
    const indexData = new Uint32Array(totalIndices);
    const wireframeIndexData = new Uint32Array(totalWireframeIndices);

    this.indexCount = indexData.length;
    this.wireframeIndexCount = wireframeIndexData.length;

    // Create Buffers
    // optimization: In a real app, you wouldn't destroy/create every frame,
    // you would create a large buffer and write into it.
    // this.vertexBuffer = this.gpu.device.createBuffer({
    //   size: Math.max(vertexData.byteLength, 32), // Min size safety
    //   usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    // });
    // this.gpu.device.queue.writeBuffer(this.vertexBuffer, 0, vertexData.buffer);

    // this.indexBuffer = this.gpu.device.createBuffer({
    //   size: Math.max(indexData.byteLength, 32),
    //   usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    // });
    // this.gpu.device.queue.writeBuffer(this.indexBuffer, 0, indexData.buffer);

    this.wireframeIndexBuffer = this.gpu.device.createBuffer({
      size: Math.max(wireframeIndexData.byteLength, 32),
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });
    this.gpu.device.queue.writeBuffer(
      this.wireframeIndexBuffer,
      0,
      wireframeIndexData.buffer
    );

    console.log(
      `Scene updated: ${geometries.length} objects, ${this.indexCount} indices`
    );
  }

  findClickedGeometry(ray: { origin: Vec3; direction: Vec3 }): {
    geometry: GeometryData;
    nodeId: string;
    distance: number;
  } | null {
    const geometries = getGeometries();
    let closestHit: {
      geometry: GeometryData;
      nodeId: string;
      distance: number;
    } | null = null;
    let closestDistance = Infinity;

    for (const geom of geometries) {
      let distance: number | null = null;

      // Try sphere intersection first (faster)
      if (geom.boundingSphere) {
        distance = this.raySphereIntersection(
          ray,
          geom.boundingSphere.center,
          geom.boundingSphere.radius
        );
      }
      // Fallback to box
      else if (geom.boundingBox) {
        distance = this.rayBoxIntersection(
          ray,
          geom.boundingBox.min,
          geom.boundingBox.max
        );
      }

      if (distance !== null && distance > 0 && distance < closestDistance) {
        closestDistance = distance;
        closestHit = {
          geometry: geom,
          nodeId: geom.sourceId || geom.id, // Use sourceId if available, fallback to id
          distance,
        };
      }
    }

    return closestHit;
  }

  private raySphereIntersection(
    ray: { origin: Vec3; direction: Vec3 },
    sphereCenter: [number, number, number],
    sphereRadius: number
  ): number | null {
    const oc = vec3.sub(ray.origin, sphereCenter);
    const a = vec3.dot(ray.direction, ray.direction);
    const b = 2.0 * vec3.dot(oc, ray.direction);
    const c = vec3.dot(oc, oc) - sphereRadius * sphereRadius;
    const discriminant = b * b - 4 * a * c;

    if (discriminant < 0) return null;

    const t = (-b - Math.sqrt(discriminant)) / (2.0 * a);
    return t > 0 ? t : null;
  }

  private rayBoxIntersection(
    ray: { origin: Vec3; direction: Vec3 },
    boxMin: [number, number, number],
    boxMax: [number, number, number]
  ): number | null {
    const invDir = [
      1 / ray.direction[0],
      1 / ray.direction[1],
      1 / ray.direction[2],
    ];

    const t1 = (boxMin[0] - ray.origin[0]) * invDir[0];
    const t2 = (boxMax[0] - ray.origin[0]) * invDir[0];
    const t3 = (boxMin[1] - ray.origin[1]) * invDir[1];
    const t4 = (boxMax[1] - ray.origin[1]) * invDir[1];
    const t5 = (boxMin[2] - ray.origin[2]) * invDir[2];
    const t6 = (boxMax[2] - ray.origin[2]) * invDir[2];

    const tmin = Math.max(
      Math.max(Math.min(t1, t2), Math.min(t3, t4)),
      Math.min(t5, t6)
    );
    const tmax = Math.min(
      Math.min(Math.max(t1, t2), Math.max(t3, t4)),
      Math.max(t5, t6)
    );

    if (tmax < 0 || tmin > tmax) return null;
    return tmin > 0 ? tmin : tmax;
  }
}
