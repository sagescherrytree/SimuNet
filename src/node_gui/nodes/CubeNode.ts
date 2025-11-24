import { Node } from "./Node";
import {
  calculateBounds,
  GeometryData,
  generateWireframeIndices,
} from "../geometry/geometry";
import { Vec3, Vec3Control } from "../controls/Vec3Control"; // Import Vec3 type
import { IGeometryGenerator } from "../interfaces/NodeCapabilities";
import { GPUContext } from "../../webgpu/GPUContext";

export class CubeNode extends Node implements IGeometryGenerator {
  positionControl: Vec3Control;
  rotationControl: Vec3Control;
  scaleControl: Vec3Control;

  constructor() {
    super("CubeNode");

    this.ioBehavior.addGeometryOutput();

    const update = () => {
      this.execute();
      this.updateBehavior.triggerUpdate();
    };

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
    const translation = this.positionControl.value;
    const rotation = this.rotationControl.value;
    const scale = this.scaleControl.value;

    const finalVertices: number[] = [];
    const finalNormals: number[] = [];
    let indices: number[] = [];
    let vertexCount = 0;

    const faceDefinitions = [
      // Face +Z (Back, Normal: [0, 0, 1]) - Vertices listed counter-clockwise from view
      {
        N: [0, 0, 1],
        V: [
          [-1, -1, 1],
          [1, -1, 1],
          [1, 1, 1],
          [-1, 1, 1],
        ],
      },
      // Face -Z (Front, Normal: [0, 0, -1])
      {
        N: [0, 0, -1],
        V: [
          [-1, 1, -1],
          [1, 1, -1],
          [1, -1, -1],
          [-1, -1, -1],
        ],
      },
      // Face +X (Right, Normal: [1, 0, 0])
      {
        N: [1, 0, 0],
        V: [
          [1, -1, -1],
          [1, -1, 1],
          [1, 1, 1],
          [1, 1, -1],
        ],
      },
      // Face -X (Left, Normal: [-1, 0, 0])
      {
        N: [-1, 0, 0],
        V: [
          [-1, -1, 1],
          [-1, -1, -1],
          [-1, 1, -1],
          [-1, 1, 1],
        ],
      },
      // Face +Y (Top, Normal: [0, 1, 0])
      {
        N: [0, 1, 0],
        V: [
          [-1, 1, 1],
          [1, 1, 1],
          [1, 1, -1],
          [-1, 1, -1],
        ],
      },
      // Face -Y (Bottom, Normal: [0, -1, 0])
      {
        N: [0, -1, 0],
        V: [
          [-1, -1, -1],
          [1, -1, -1],
          [1, -1, 1],
          [-1, -1, 1],
        ],
      },
    ];

    const quadTriangles = [0, 1, 2, 0, 2, 3];

    for (const face of faceDefinitions) {
      const N = face.N;
      const V_face = face.V;

      for (const index of quadTriangles) {
        const V = V_face[index];

        const [x, y, z] = this.transfromVertices(
          V,
          translation,
          rotation,
          scale
        );

        finalVertices.push(x, y, z);

        finalNormals.push(N[0], N[1], N[2]);

        indices.push(vertexCount++);
      }
    }

    const bounds = calculateBounds(finalVertices);

    const wireframeIndices = generateWireframeIndices(new Uint32Array(indices));

    const gpu = GPUContext.getInstance();

    const vertexData = new Float32Array(
      vertexCount * 8
    );

    // TODO does / 3 ever have rounding issues?
    for (let i = 0; i < finalVertices.length / 3; i++) {
      vertexData[8 * i] = finalVertices[i * 3];
      vertexData[8 * i + 1] = finalVertices[i * 3 + 1];
      vertexData[8 * i + 2] = finalVertices[i * 3 + 2];
      vertexData[8 * i + 3] = 0;
      vertexData[8 * i + 4] = finalNormals[i * 3];
      vertexData[8 * i + 5] = finalNormals[i * 3 + 1];
      vertexData[8 * i + 6] = finalNormals[i * 3 + 2];
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
      vertices: new Float32Array(finalVertices),
      indices: new Uint32Array(indices),
      normals: new Float32Array(finalNormals),
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

  private transfromVertices(
    V: number[],
    translation: Vec3,
    rotation: Vec3,
    scale: Vec3
  ): [number, number, number] {
    const [x0, y0, z0] = V;

    const rx = (rotation.x * Math.PI) / 180;
    const ry = (rotation.y * Math.PI) / 180;
    const rz = (rotation.z * Math.PI) / 180;

    const sx = Math.sin(rx),
      cx = Math.cos(rx);
    const sy = Math.sin(ry),
      cy = Math.cos(ry);
    const sz = Math.sin(rz),
      cz = Math.cos(rz);

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
    return [x3 + translation.x, y3 + translation.y, z2 + translation.z];
  }

  async execute() {
    // Update geometry if control changed
    this.geometry = this.generateGeometry();
    console.log("Cube node generated geometry:", this.geometry);

    return { geometry: this.geometry };
  }

  getEditableControls() {
    return {
      position: this.positionControl,
      rotation: this.rotationControl,
      scale: this.scaleControl,
    };
  }
}
