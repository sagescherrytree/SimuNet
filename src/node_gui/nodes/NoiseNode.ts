import { Node } from "./Node";
import { GeometryData } from "../../geometry/geometry";
import { NumberControl } from "../controls/NumberControl";
import { IGeometryModifier } from "../interfaces/NodeCapabilities";
import { IVertexDeformer } from "../interfaces/NodeCapabilities";

export class NoiseNode
  extends Node
  implements IGeometryModifier, IVertexDeformer
{
  public geometry?: GeometryData;
  public inputGeometry?: GeometryData;

  strengthControl: NumberControl;
  scaleControl: NumberControl;
  seedControl: NumberControl;

  constructor() {
    super("NoiseNode");

    this.ioBehavior.addGeometryInput();
    this.ioBehavior.addGeometryOutput();

    const onChange = () => {
      if (this.inputGeometry) {
        this.applyModification(this.inputGeometry);
      }
      this.updateBehavior.triggerUpdate();
    };

    this.strengthControl = new NumberControl("Strength", 0.5, onChange, 0.1);
    this.scaleControl = new NumberControl("Scale", 1.0, onChange, 0.1);
    this.seedControl = new NumberControl("Seed", 0, onChange, 1, 0, 1000);
  }

  setInputGeometry(geometry: GeometryData) {
    this.inputGeometry = geometry;
    this.applyModification(geometry);
  }

  applyModification(input: GeometryData): GeometryData | undefined {
    if (!input) return;

    const deformed = this.deformVertices(input.vertices);
    this.geometryBehavior.updateGeometry(input.sourceId || input.id, deformed);

    this.geometry = {
      vertices: deformed,
      indices: new Uint32Array(input.indices),
      id: this.id,
      sourceId: input.sourceId || input.id,
    };

    return this.geometry;
  }

  deformVertices(vertices: Float32Array): Float32Array {
    const deformed = new Float32Array(vertices.length);
    const strength = this.strengthControl.value ?? 0.5;
    const scale = this.scaleControl.value ?? 1.0;
    const seed = this.seedControl.value ?? 0;

    for (let i = 0; i < vertices.length; i += 3) {
      const x = vertices[i];
      const y = vertices[i + 1];
      const z = vertices[i + 2];

      const noise = this.simpleNoise(x * scale + seed, y * scale, z * scale);

      const len = Math.sqrt(x * x + y * y + z * z) || 1;
      const nx = x / len,
        ny = y / len,
        nz = z / len;

      deformed[i] = x + nx * noise * strength;
      deformed[i + 1] = y + ny * noise * strength;
      deformed[i + 2] = z + nz * noise * strength;
    }

    return deformed;
  }

  private simpleNoise(x: number, y: number, z: number): number {
    return Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 0.5 + 0.5;
  }

  async execute(inputs?: Record<string, any>) {
    const geom = inputs?.geometry?.[0] as GeometryData;
    if (!geom) {
      console.warn("NoiseNode: No input geometry");
      return;
    }

    this.geometry = this.applyModification(geom);
    return { geometry: this.geometry };
  }

  getEditableControls() {
    return {
      strength: this.strengthControl,
      scale: this.scaleControl,
      seed: this.seedControl,
    };
  }
}
