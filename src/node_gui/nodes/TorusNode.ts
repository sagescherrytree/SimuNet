import { Node } from "./Node";
import {
  calculateBounds,
  generateWireframeIndices,
  GeometryData,
} from "../geometry/geometry";
import { NumberControl } from "../controls/NumberControl";
import { Vec3Control } from "../controls/Vec3Control";
import { IGeometryGenerator } from "../interfaces/NodeCapabilities";
import { GPUContext } from "../../webgpu/GPUContext";

export class TorusNode extends Node implements IGeometryGenerator {
  majorRadiusControl: NumberControl;
  minorRadiusControl: NumberControl;
  radialSegmentsControl: NumberControl;
  tubularSegmentsControl: NumberControl;
  positionControl: Vec3Control;
  rotationControl: Vec3Control;

  constructor() {
    super("TorusNode");

    this.ioBehavior.addGeometryOutput();

    const update = () => {
      this.execute();
      this.updateBehavior.triggerUpdate();
    };

    this.majorRadiusControl = new NumberControl("Major Radius", 1.0, update);
    this.minorRadiusControl = new NumberControl("Minor Radius", 0.4, update);
    this.tubularSegmentsControl = new NumberControl(
      "Tubular Segments",
      32,
      update,
      1,
      4,
      256
    );
    this.radialSegmentsControl = new NumberControl(
      "Radial Segments",
      16,
      update,
      1,
      3,
      64
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

    this.geometry = this.generateGeometry();
  }

  private rotatePoint(
    x: number,
    y: number,
    z: number,
    rx: number,
    ry: number,
    rz: number
  ): [number, number, number] {
    let px = x;
    let py = y;
    let pz = z;

    const cosX = Math.cos(rx);
    const sinX = Math.sin(rx);
    let tempY = py * cosX - pz * sinX;
    let tempZ = py * sinX + pz * cosX;
    py = tempY;
    pz = tempZ;

    const cosY = Math.cos(ry);
    const sinY = Math.sin(ry);
    let tempX = px * cosY + pz * sinY;
    tempZ = pz * cosY - px * sinY;
    px = tempX;
    pz = tempZ;

    const cosZ = Math.cos(rz);
    const sinZ = Math.sin(rz);
    tempX = px * cosZ - py * sinZ;
    tempY = px * sinZ + py * cosZ;
    px = tempX;
    py = tempY;

    return [px, py, pz];
  }

  generateGeometry(): GeometryData {
    const R = this.majorRadiusControl.value ?? 1.0;
    const r = this.minorRadiusControl.value ?? 0.4;
    const tubularSegments = Math.max(
      3,
      Math.floor(this.tubularSegmentsControl.value ?? 32)
    );
    const radialSegments = Math.max(
      3,
      Math.floor(this.radialSegmentsControl.value ?? 16)
    );
    const pos = this.positionControl.value;
    const rot = this.rotationControl.value;

    const degToRad = Math.PI / 180;
    const rx = rot.x * degToRad;
    const ry = rot.y * degToRad;
    const rz = rot.z * degToRad;

    const vertices: number[] = [];
    const indices: number[] = [];

    const baseNormals: number[] = [];

    let vertexCount = 0;

    for (let i = 0; i <= tubularSegments; i++) {
      const u = (i / tubularSegments) * 2 * Math.PI;
      const cosU = Math.cos(u);
      const sinU = Math.sin(u);

      const innerCircleX = Math.cos(u) * R;
      const innerCircleZ = Math.sin(u) * R;
      for (let j = 0; j <= radialSegments; j++) {
        const v = (j / radialSegments) * 2 * Math.PI;
        const cosV = Math.cos(v);
        const sinV = Math.sin(v);

        const tubeRadius = R + r * cosV;
        const base_x = tubeRadius * cosU;
        const base_y = r * sinV;
        const base_z = tubeRadius * sinU;

        const dX = base_x - innerCircleX;
        const dY = base_y;
        const dZ = base_z - innerCircleZ;
        const dLength = Math.sqrt(dX * dX + dY * dY + dZ * dZ);
        baseNormals.push(dX / dLength, dY / dLength, dZ / dLength);

        const [rot_x, rot_y, rot_z] = this.rotatePoint(
          base_x,
          base_y,
          base_z,
          rx,
          ry,
          rz
        );

        const final_x = rot_x + pos.x;
        const final_y = rot_y + pos.y;
        const final_z = rot_z + pos.z;

        vertices.push(final_x, final_y, final_z);
        vertexCount += 3;

        if (i < tubularSegments && j < radialSegments) {
          const a = i * (radialSegments + 1) + j;
          const b = a + radialSegments + 1;
          const c = a + 1;
          const d = b + 1;

          indices.push(a, c, b);

          indices.push(c, d, b);
        }
      }
    }

    const bounds = calculateBounds(vertices);

    const wireframeIndices = generateWireframeIndices(new Uint32Array(indices));

    const gpu = GPUContext.getInstance();

    // TODO transform normals too
    const vertexData = new Float32Array(vertexCount * 8);
    for (let i = 0; i < vertices.length / 3; i++) {
      vertexData[8 * i] = vertices[i * 3];
      vertexData[8 * i + 1] = vertices[i * 3 + 1];
      vertexData[8 * i + 2] = vertices[i * 3 + 2];
      vertexData[8 * i + 3] = 0;
      vertexData[8 * i + 4] = baseNormals[i * 3];
      vertexData[8 * i + 5] = baseNormals[i * 3 + 1];
      vertexData[8 * i + 6] = baseNormals[i * 3 + 2];
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

    return {
      vertices: new Float32Array(vertices),
      indices: new Uint32Array(indices),
      wireframeIndices: wireframeIndices,
      vertexBuffer: vertexBuffer,
      indexBuffer: indexBuffer,
      id: this.id,
      sourceId: this.id,
      boundingSphere: bounds.sphere,
      boundingBox: bounds.box,
    };
  }

  async execute() {
    this.geometry = this.generateGeometry();
    console.log("Torus node generated geometry:", this.geometry);

    return { geometry: this.geometry };
  }

  getEditableControls() {
    return {
      majorRadius: this.majorRadiusControl,
      minorRadius: this.minorRadiusControl,
      tubularSegments: this.tubularSegmentsControl,
      radialSegments: this.radialSegmentsControl,
      position: this.positionControl,
      rotation: this.rotationControl,
    };
  }
}
