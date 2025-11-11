// src/components/nodes/NodeA.ts
import { ClassicPreset } from "rete";

export class Node extends ClassicPreset.Node {
  height = 140;
  width = 200;

  constructor(name: string) {
    super(name);
  }
}
