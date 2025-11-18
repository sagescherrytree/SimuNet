// src/components/nodes/NodeB.ts
import { Node } from "./Node";
import { GeometryData } from "../geometry/geometry";
import { Vec3Control } from "../controls/Vec3Control";
import { IGeometryModifier } from "../interfaces/NodeCapabilities";
import { Vec3 } from "../controls/Vec3Control";

export class TransformNode extends Node implements IGeometryModifier {
  height = 140;
  width = 200;

  translation: Vec3Control;
  rotation: Vec3Control;
  scale: Vec3Control;

  geometry?: GeometryData;
  public inputGeometry?: GeometryData;

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
    this.applyModification(geometry);
  }

  applyModification(input: GeometryData): GeometryData | undefined {
    if (!input) return;

    const transformed = this.transformVertices(
      input.vertices,
      this.translation.value,
      this.rotation.value,
      this.scale.value
    );

    try {
      this.geometryBehavior.updateGeometry(
        input.sourceId ?? input.id,
        transformed
      );
    } catch (e) {
      console.warn("updateGeometry failed:", e);
    }

    console.log("TransformNode applied: " + input.id + " " + input.sourceId);

    this.geometry = {
      vertices: transformed,
      indices: new Uint32Array(input.indices),
      id: this.id,
      sourceId: input.sourceId ?? input.id,
    };

    console.log (this.geometry.vertices == this.inputGeometry.vertices);

    return this.geometry;
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
