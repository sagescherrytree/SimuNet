import { ClassicPreset } from "rete";
import { socket } from "../types";

/**
 * Composable behavior for input/output management
 */
export class IOBehavior {
  constructor(private node: ClassicPreset.Node) {}

  addGeometryInput(key: string = "geometry", label: string = "Input Geometry") {
    this.node.addInput(key, new ClassicPreset.Input(socket, label));
  }

  addGeometryOutput(key: string = "geometry", label: string = "Geometry") {
    this.node.addOutput(key, new ClassicPreset.Output(socket, label));
  }

  addMultipleInputs(count: number) {
    for (let i = 0; i < count; i++) {
      this.addGeometryInput(`geometry${i}`, `Input ${i + 1}`);
    }
  }
}
