import { Node } from "./Node";
import { calculateBounds, GeometryData } from "../geometry/geometry";
import { NumberControl } from "../controls/NumberControl";
import { Vec3, Vec3Control } from "../controls/Vec3Control"; // Import Vec3 type
import { IGeometryGenerator } from "../interfaces/NodeCapabilities";

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

    const baseVertices = [
      [-1, -1, -1], // 0
      [1, -1, -1], // 1
      [1, 1, -1], // 2
      [-1, 1, -1], // 3
      [-1, -1, 1], // 4
      [1, -1, 1], // 5
      [1, 1, 1], // 6
      [-1, 1, 1], // 7
    ];

    const transformedVertices = this.transformVertices(
      baseVertices,
      translation,
      rotation,
      scale
    );

    const indices = new Uint32Array([
      // front
      0, 2, 1, 0, 3, 2,
      // back
      4, 5, 6, 4, 6, 7,
      // top
      3, 6, 2, 3, 7, 6,
      // bottom
      0, 1, 5, 0, 5, 4,
      // right
      1, 6, 5, 1, 2, 6,
      // left
      0, 7, 3, 0, 4, 7,
    ]);

    const bounds = calculateBounds(transformedVertices);

    return {
      vertices: new Float32Array(transformedVertices),
      indices,
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

      // Rotate (X -> Y -> Z order, same as TransformNode)

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
