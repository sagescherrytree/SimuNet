// src/components/nodes/NodeB.ts
import { ClassicPreset } from "rete";
import { Node } from "./Node";
import { socket } from "../types";
import {
  GeometryData,
  updateGeometry,
  addGeometry,
  removeTransform,
  removeGeometry,
} from "../../geometry/geometry";
import { Vec3Control } from "../controls/Vec3Control";

export class TransformNode extends Node {
  height = 140;
  width = 200;

  translation: Vec3Control;
  rotation: Vec3Control;
  scale: Vec3Control;

  private inputGeometry?: GeometryData;

  constructor() {
    super("TransformNode");

    // Input geometry from other nodes
    this.addInput(
      "input geometry",
      new ClassicPreset.Input(socket, "Input Geometry")
    );

    // Output geometry
    this.addOutput(
      "output geometry",
      new ClassicPreset.Output(socket, "Output Geometry")
    );

    // Handler when controls change
    const onChange = () => {
      if (this.inputGeometry) {
        this.applyTransform(this.inputGeometry);
      }
    };

    this.translation = new Vec3Control(
      "Translation",
      { x: 0, y: 0, z: 0 },
      onChange
    );
    this.rotation = new Vec3Control("Rotation", { x: 0, y: 0, z: 0 }, onChange);
    this.scale = new Vec3Control("Scale", { x: 1, y: 1, z: 1 }, onChange); // default 1 for scale

    // Subscribe to new geometries from other nodes
    import("../../geometry/geometry").then(({ onNewGeometry }) => {
      onNewGeometry((geom) => {
        // If this node is connected to the input geometry, store it
        if (!this.inputGeometry) {
          this.inputGeometry = geom;
          this.applyTransform(geom);
        }
      });
    });
  }

  setInputGeometry(geometry: GeometryData) {
    this.inputGeometry = geometry;
  }

  removeNode(sourceNode: Node) {
    console.log("Source Node:", sourceNode);
    removeGeometry(sourceNode.id);
    addGeometry({
      vertices: new Float32Array((sourceNode as any).geometry.vertices),
      indices: new Uint32Array((sourceNode as any).geometry.indices),
      id: sourceNode.id,
    });
  }

  async execute(context?: any) {
    // For integration with Rete engine connections (optional)
    const input = this.inputs["input geometry"];
    console.log("INPUT OBJECT:", input);
    if (!input) {
      console.warn("No input object found at all");
      return;
    }

    const geom: GeometryData = input[0] as GeometryData;

    this.applyTransform(geom);

    return { geometry: this.inputGeometry };
  }

  private applyTransform(input: GeometryData) {
    if (!input) return;

    const t = this.translation.value;
    const r = this.rotation.value;
    const s = this.scale.value;

    const vertices = input.vertices;
    const transformed = new Float32Array(vertices.length);

    const rx = (r.x * Math.PI) / 180.0;
    const ry = (r.y * Math.PI) / 180.0;
    const rz = (r.z * Math.PI) / 180.0;

    const sx = Math.sin(rx),
      cx = Math.cos(rx);
    const sy = Math.sin(ry),
      cy = Math.cos(ry);
    const sz = Math.sin(rz),
      cz = Math.cos(rz);

    for (let i = 0; i < vertices.length; i += 3) {
      let x = vertices[i];
      let y = vertices[i + 1];
      let z = vertices[i + 2];

      x = x * s.x;
      y = y * s.y;
      z = z * s.z;

      let y1 = y * cx - z * sx;
      let z1 = y * sx + z * cx;

      let x2 = x * cy + z1 * sy;
      let z2 = -x * sy + z1 * cy;

      let x3 = x2 * cz - y1 * sz;
      let y3 = x2 * sz + y1 * cz;

      transformed[i] = x3 + t.x;
      transformed[i + 1] = y3 + t.y;
      transformed[i + 2] = z2 + t.z;
    }

    try {
      updateGeometry(input.id, transformed);
    } catch (e) {
      console.warn(
        "updateGeometry failed, make sure to import it. Falling back if desired.",
        e
      );
    }

    console.log("TransformNode applied transform:", input.id);
  }

  getEditableControls() {
    return {
      translation: this.translation,
      rotation: this.rotation,
      scale: this.scale,
    };
  }
}
