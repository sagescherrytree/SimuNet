// src/components/nodes/NodeA.ts
import { ClassicPreset } from "rete";
import { Node } from "./Node";
import { socket } from "../types";

export class NodeA extends Node {
  height = 140;
  width = 200;

  constructor() {
    super("NodeA");

    this.addControl("a", new ClassicPreset.InputControl("text", {}));
    this.addOutput("a", new ClassicPreset.Output(socket));
  }
}
