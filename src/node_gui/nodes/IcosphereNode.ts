import { Node } from "./Node";
import {
  GeometryData,
  calculateBounds,
  generateWireframeIndices,
} from "../geometry/geometry";
import { NumberControl } from "../controls/NumberControl";
import { Vec3, Vec3Control } from "../controls/Vec3Control";
import { IGeometryGenerator } from "../interfaces/NodeCapabilities";
import { GPUContext } from "../../webgpu/GPUContext";

export class IcosphereNode extends Node implements IGeometryGenerator {
  subdivisionsControl: NumberControl;
  positionControl: Vec3Control;
  rotationControl: Vec3Control;
  scaleControl: Vec3Control;

  constructor() {
    super("IcosphereNode");

    this.ioBehavior.addGeometryOutput();

    const update = () => {
      this.execute();
      this.updateBehavior.triggerUpdate();
    };

    this.subdivisionsControl = new NumberControl(
      "Subdivisions",
      2.0,
      update,
      1.0,
      0,
      6
    );

    this.positionControl = new Vec3Control(
      "Position",
      { x: 0, y: 0, z: 0 },
      update
    );

    this.rotationControl = new Vec3Control(
      "Rotation",
      { x: 0, y: 0, z: 0 },
      update,
      5
    );

    this.scaleControl = new Vec3Control("Scale", { x: 1, y: 1, z: 1 }, update);

    this.geometry = this.generateGeometry();
  }

  generateGeometry(): GeometryData {
    const subdivisions = this.subdivisionsControl.value ?? 2.0;

    const translation = this.positionControl.value;
    const rotation = this.rotationControl.value;
    const scale = this.scaleControl.value;

    const phi = (1 + Math.sqrt(5.0)) * 0.5;

    const Z = 1.0;
    const X = 1.0 / phi;

    let baseVertices = [
      [-X, 0, Z],
      [X, 0, Z],
      [-X, 0, -Z],
      [X, 0, -Z],
      [0, Z, X],
      [0, Z, -X],
      [0, -Z, X],
      [0, -Z, -X],
      [Z, X, 0],
      [-Z, X, 0],
      [Z, -X, 0],
      [-Z, -X, 0],
    ];

    for (let i = 0; i < baseVertices.length; ++i) {
      let len = 0;
      for (let j = 0; j < 3; ++j) {
        len += baseVertices[i][j] * baseVertices[i][j];
      }
      let divisor = Math.sqrt(len);
      for (let j = 0; j < 3; ++j) {
        baseVertices[i][j] /= divisor;
      }
    }

    let triIndices = [
      0, 1, 4, 0, 4, 9, 9, 4, 5, 4, 8, 5, 4, 1, 8, 8, 1, 10, 8, 10, 3, 5, 8, 3,
      5, 3, 2, 2, 3, 7, 7, 3, 10, 7, 10, 6, 7, 6, 11, 11, 6, 0, 0, 6, 1, 6, 10,
      1, 9, 11, 0, 9, 2, 11, 9, 5, 2, 7, 11, 2,
    ];

    const triSplitMap = new Map<string, number>();
    function midpoint(idx0: number, idx1: number): number {
      let key = [idx0, idx1].sort().join("_");
      if (!triSplitMap.has(key)) {
        let newVert = [...baseVertices[idx0]];
        let sum = 0;
        for (let i = 0; i < 3; ++i) {
          newVert[i] = (newVert[i] + baseVertices[idx1][i]) * 0.5;
          sum += newVert[i] * newVert[i];
        }
        let len = Math.sqrt(sum);
        for (let i = 0; i < 3; ++i) {
          newVert[i] /= len; // Normalize to radius 1 again
        }
        triSplitMap.set(key, baseVertices.length);
        baseVertices.push(newVert);
      }
      return triSplitMap.get(key);
    }

    // Subdivision loop
    for (let i = 0; i < subdivisions; ++i) {
      const newTriangles = [];
      for (let j = 0; j < triIndices.length; j += 3) {
        let v0 = triIndices[j];
        let v1 = triIndices[j + 1];
        let v2 = triIndices[j + 2];

        let v01 = midpoint(v0, v1);
        let v02 = midpoint(v0, v2);
        let v12 = midpoint(v1, v2);

        newTriangles.push(v0, v01, v02);
        newTriangles.push(v1, v12, v01);
        newTriangles.push(v2, v02, v12);
        newTriangles.push(v01, v12, v02);
      }
      triIndices = newTriangles;
    }

    const indices = new Uint32Array(triIndices);

    const wireframeIndices = generateWireframeIndices(new Uint32Array(indices));

    const baseNormals: number[][] = baseVertices.slice();

    // Transformation logic applied here
    const transformedVertices: number[] = this.transformVertices(
      baseVertices,
      translation,
      rotation,
      scale
    );

    // TODO apply transforms to normals as well (inverse transpose of transformation matrix--rotate and invert scale)
    // TODO can .flatMpa for applying transform
    const transformedNormals: number[] = baseNormals.flat();

    const bounds = calculateBounds(transformedVertices);

    const gpu = GPUContext.getInstance();

    const vertexData = new Float32Array(
      triIndices.length * 8
    );

    for (let i = 0; i < transformedVertices.length / 3; i++) {
      vertexData[8 * i] = transformedVertices[i * 3];
      vertexData[8 * i + 1] = transformedVertices[i * 3 + 1];
      vertexData[8 * i + 2] = transformedVertices[i * 3 + 2];
      vertexData[8 * i + 3] = 0;
      vertexData[8 * i + 4] = transformedNormals[i * 3];
      vertexData[8 * i + 5] = transformedNormals[i * 3 + 1];
      vertexData[8 * i + 6] = transformedNormals[i * 3 + 2];
      vertexData[8 * i + 7] = 0;
    }


    const vertexBuffer = gpu.device.createBuffer({
      size: Math.max(vertexData.byteLength, 32), // Min size safety
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    gpu.device.queue.writeBuffer(vertexBuffer, 0, vertexData.buffer);

    const indexData = new Uint32Array(indices);
    const indexBuffer = gpu.device.createBuffer({
      size: Math.max(indexData.byteLength, 32),
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    gpu.device.queue.writeBuffer(indexBuffer, 0, indexData.buffer);



    const wireframeIndexBuffer = gpu.device.createBuffer({
      size: Math.max(wireframeIndices.byteLength, 32),
      usage: GPUBufferUsage.INDEX | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST,
    });
    gpu.device.queue.writeBuffer(wireframeIndexBuffer, 0, wireframeIndices.buffer);


    // TODO remove all the CPU-side vertices/indices; slower w/ those being passed around and not needed anymore
    return {
      vertices: new Float32Array(transformedVertices),
      indices,
      wireframeIndices: wireframeIndices,
      wireframeIndexBuffer: wireframeIndexBuffer,
      vertexBuffer: vertexBuffer,
      indexBuffer: indexBuffer,
      id: this.id,
      sourceId: this.id,
      boundingSphere: bounds.sphere,
      boundingBox: bounds.box,
    };
  }

  private transformVertices(
    baseVertices: number[][],
    translation: Vec3,
    rotation: Vec3,
    scale: Vec3
  ): number[] {
    const transformed: number[] = [];
    // Convert degrees to radians for rotation
    const rx = (rotation.x * Math.PI) / 180;
    const ry = (rotation.y * Math.PI) / 180;
    const rz = (rotation.z * Math.PI) / 180;

    // Precalculate sin and cos values
    const sx = Math.sin(rx),
      cx = Math.cos(rx);
    const sy = Math.sin(ry),
      cy = Math.cos(ry);
    const sz = Math.sin(rz),
      cz = Math.cos(rz);

    for (const [x0, y0, z0] of baseVertices) {
      // Scale
      let x = x0 * scale.x;
      let y = y0 * scale.y;
      let z = z0 * scale.z;

      // X-Rotation
      let y1 = y * cx - z * sx;
      let z1 = y * sx + z * cx;

      // Y-Rotation
      let x2 = x * cy + z1 * sy;
      let z2 = -x * sy + z1 * cy;

      // Z-Rotation
      let x3 = x2 * cz - y1 * sz;
      let y3 = x2 * sz + y1 * cz;

      // Translate (Position)
      transformed.push(
        x3 + translation.x,
        y3 + translation.y,
        z2 + translation.z
      );
    }

    return transformed;
  }

  async execute() {
    // Update geometry if control changed
    this.geometry = this.generateGeometry();
    console.log("Icosphere node generated geometry:", this.geometry);

    return { geometry: this.geometry };
  }

  getEditableControls() {
    return {
      subdivisions: this.subdivisionsControl,
      position: this.positionControl,
      rotation: this.rotationControl,
      scale: this.scaleControl,
    };
  }
}
