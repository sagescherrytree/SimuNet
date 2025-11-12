// src/components/nodes/NodeB.ts
import { ClassicPreset } from "rete";
import { Node } from "./Node";
import { socket } from "../types";

export class TransformNode extends Node {
  height = 140;
  width = 200;

  translation: ClassicPreset.InputControl<"number">;
  rotation: ClassicPreset.InputControl<"number">;
  scale: ClassicPreset.InputControl<"number">;

  constructor() {
    super("TransformNode");

    this.addControl("b", new ClassicPreset.InputControl("text", {}));
    this.addInput("b", new ClassicPreset.Input(socket));
  }
}
