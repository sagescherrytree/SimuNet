// src/components/nodes/NodeB.ts
import { ClassicPreset } from "rete";
import { Node } from "./Node";
import { socket } from "../types";
import { GeometryData, getGeometries } from "../../geometry/geometry";
import { Vec3Control } from "../controls/Vec3Control";

export class TransformNode extends Node {
  height = 140;
  width = 200;

  translation: Vec3Control;
  rotation: Vec3Control;
  scale: Vec3Control;

  constructor() {
    super("TransformNode");

    const onChange = () => {
      this.execute();
    };

    // Input geometry.
    this.addInput(
      "input geometry",
      new ClassicPreset.Input(socket, "Input Geometry")
    );

    // Filler for the time being.
    this.translation = new Vec3Control(
      "Translation",
      { x: 0, y: 0, z: 0 },
      onChange
    );

    this.rotation = new Vec3Control("Rotation", { x: 0, y: 0, z: 0 }, onChange);

    this.scale = new Vec3Control("Scale", { x: 0, y: 0, z: 0 }, onChange);

    // Transformed geometry.
    this.addOutput(
      "output geometry",
      new ClassicPreset.Output(socket, "Output Geometry")
    );
  }

  async execute(context?: any) {
    // TODO:: use translation, rotation, scale to modify vertices of input geometry.
    // RemoveGeometry?
    // Somehow access input geometry's current geom based on ID, or somehow through connection.
    // In the geometry struct, there is vertices array as well.
    // Apply transformation to vertices array.
    // Readd geometry with new vert positions.

    const input = context.inputs["input geometry"]?.[0];
    if (!input) return;

    const geomId = input.id;
    const geometries = getGeometries();
    const geom = geometries.find((g) => g.id === geomId);
    if (!geom) return;

    // Fill in transform stuff here.

    return { geometry: geom };
  }

  getEditableControls() {
    return {
      translation: this.translation,
      rotation: this.rotation,
      scale: this.scale,
    };
  }
}
