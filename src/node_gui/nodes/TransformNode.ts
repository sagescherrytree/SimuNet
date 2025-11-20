// src/components/nodes/NodeB.ts
import { Node } from "./Node";
import { GeometryData } from "../geometry/geometry";
import { Vec3Control } from "../controls/Vec3Control";
import { IGeometryModifier } from "../interfaces/NodeCapabilities";
import { Vec3 } from "../controls/Vec3Control";
import { GPUContext } from "../../webgpu/GPUContext";

export class TransformNode extends Node implements IGeometryModifier {
  translation: Vec3Control;
  rotation: Vec3Control;
  scale: Vec3Control;

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
    this.applyModification(this.inputGeometry);
  }

  applyModification(input: GeometryData): GeometryData | undefined {
    if (!input) return;
    // TODO once operating on GPU-side, probably make this.outputEnabled into more of a passthrough:
    //  that is, here check: 
    //  if (this.outputEnabled) {
    //    ... // do this transformation
    //  } else {
    //   use copyBufferToBuffer to copy inputGeometry vertex/index buffers directly to output
    //  }

    const transformed = this.transformVertices(
      input.vertices,
      this.translation.value,
      this.rotation.value,
      this.scale.value
    );

    // TODO: Pass in vertex + index buffer from primitive node: input.vertexBuffer, input.indexBuffer
    // TODO: Invoke compute shader.

    this.geometry = {
      vertices: transformed,
      indices: new Uint32Array(input.indices),
      // TODO set vertexBuffer and indexBuffer (eventually, remove .vertices and .indices^)
      id: this.id,
      sourceId: input.sourceId ?? input.id,
    };

    if (this.geometry.vertices == this.inputGeometry.vertices) {
      console.warn(
        "TransformNode: Input geometry and output using same vertex array"
      );
    }

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
