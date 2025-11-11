// src/components/nodes/NodeB.ts
import { ClassicPreset } from "rete";
import { Node } from "./Node";
import { socket } from "../types";

export class NodeB extends Node {
  height = 140;
  width = 200;

  constructor() {
    super("NodeB");

    this.addControl("b", new ClassicPreset.InputControl("text", {}));
    this.addInput("b", new ClassicPreset.Input(socket));
  }
}
