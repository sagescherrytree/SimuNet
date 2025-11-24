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

export class PlaneNode extends Node implements IGeometryGenerator {
  widthControl: NumberControl;
  heightControl: NumberControl;
  positionControl: Vec3Control;
  rotationControl: Vec3Control;

  constructor() {
    super("PlaneNode");

    this.ioBehavior.addGeometryOutput();

    const update = () => {
      this.execute();
      this.updateBehavior.triggerUpdate();
    };

    this.widthControl = new NumberControl("Width", 2.0, update);
    this.heightControl = new NumberControl("Height", 2.0, update);

    this.positionControl = new Vec3Control(
      "Position",
      { x: 0, y: 0, z: 0 },
      update
    );

    this.rotationControl = new Vec3Control(
      "Rotation",
      { x: 0, y: 0, z: 0 },
      update,
      5.0
    );
    // TODO add subdivisions option

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
    const width = this.widthControl.value ?? 2.0;
    const height = this.heightControl.value ?? 2.0;
    const pos = this.positionControl.value;
    const rot = this.rotationControl.value;

    const degToRad = Math.PI / 180;
    const rx = rot.x * degToRad;
    const ry = rot.y * degToRad;
    const rz = rot.z * degToRad;

    const w2 = width / 2;
    const h2 = height / 2;

    const baseVertices = [
      [-w2, 0, -h2],
      [w2, 0, -h2],
      [w2, 0, h2],
      [-w2, 0, h2],
    ];

    const transformedVertices: number[] = [];
    for (const [x, y, z] of baseVertices) {
      const [rx_out, ry_out, rz_out] = this.rotatePoint(x, y, z, rx, ry, rz);

      transformedVertices.push(rx_out + pos.x, ry_out + pos.y, rz_out + pos.z);
    }

    const indices = new Uint32Array([0, 2, 1, 0, 3, 2]);

    const bounds = calculateBounds(transformedVertices);

    const wireframeIndices = generateWireframeIndices(new Uint32Array(indices));

    const gpu = GPUContext.getInstance();

    // TODO adapt for subdivision options
    const vertexData = new Float32Array(4 * 8);
    const upVector = [0, 1, 0]; // TODO apply transform

    for (let i = 0; i < transformedVertices.length / 3; i++) {
      vertexData[8 * i] = transformedVertices[i * 3];
      vertexData[8 * i + 1] = transformedVertices[i * 3 + 1];
      vertexData[8 * i + 2] = transformedVertices[i * 3 + 2];
      vertexData[8 * i + 3] = 0;
      vertexData[8 * i + 4] = upVector[0];
      vertexData[8 * i + 5] = upVector[1];
      vertexData[8 * i + 6] = upVector[2];
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

    return {
      vertices: new Float32Array(transformedVertices),
      indices,
      wireframeIndices: wireframeIndices,
      vertexBuffer: vertexBuffer,
      indexBuffer: indexBuffer,
      wireframeIndexBuffer: wireframeIndexBuffer,
      id: this.id,
      sourceId: this.id,
      boundingSphere: bounds.sphere,
      boundingBox: bounds.box,
    };
  }

  async execute() {
    this.geometry = this.generateGeometry();
    console.log("Plane node generated geometry:", this.geometry);

    return { geometry: this.geometry };
  }

  getEditableControls() {
    return {
      width: this.widthControl,
      height: this.heightControl,
      position: this.positionControl,
      rotation: this.rotationControl,
    };
  }
}
