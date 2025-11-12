// src/components/nodes/NodeB.ts
import { ClassicPreset } from "rete";
import { Node } from "./Node";
import { socket } from "../types";
import { GeometryData, getGeometries } from "../../geometry/geometry";

export class TransformNode extends Node {
  height = 140;
  width = 200;

  translation: ClassicPreset.InputControl<"number">;
  rotation: ClassicPreset.InputControl<"number">;
  scale: ClassicPreset.InputControl<"number">;

  constructor() {
    super("TransformNode");

    // Input geometry.
    this.addInput("input geometry", new ClassicPreset.Input(socket, "Input Geometry"));

    // Filler for the time being.
    this.addControl("translation", this.translation);
    this.addControl("rotation", this.rotation);
    this.addControl("scale", this.scale);

    // Transformed geometry. 
    this.addOutput("output geometry", new ClassicPreset.Output(socket, "Output Geometry"));
  }

  async execute(context: any) {
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
    const geom = geometries.find(g => g.id === geomId);
    if (!geom) return;

    // Fill in transform stuff here.

    return { geometry: geom };
  }
}
