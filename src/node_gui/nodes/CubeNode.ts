import { ClassicPreset } from "rete";
import { Node } from "./Node";
import { socket } from "../types";
import { GeometryData, addGeometry, removeGeometry } from "../../geometry/geometry";

export class CubeNode extends Node {
  height = 180;
  width = 200;

  geometry: GeometryData;
  sizeControl: ClassicPreset.InputControl<"number">;

  constructor() {
    super("CubeNode");

    // this.addControl("a", new ClassicPreset.InputControl("text", {}));
    this.addOutput("a", new ClassicPreset.Output(socket));

    this.sizeControl = new ClassicPreset.InputControl("number", {
      initial: 1.0,
      change: (value) => {
        removeGeometry(this.id);
        this.execute();
      }
    });


    this.addControl("size", this.sizeControl);
    this.addOutput("geometry", new ClassicPreset.Output(socket, "Geometry"));


    this.geometry = this.createCubeGeometry(1.0);
  }

  createCubeGeometry(size: number): GeometryData {
    const s = size / 2;

    const vertices = new Float32Array([
      -s,
      -s,
      -s, // 0
      s,
      -s,
      -s, // 1
      s,
      s,
      -s, // 2
      -s,
      s,
      -s, // 3
      -s,
      -s,
      s, // 4
      s,
      -s,
      s, // 5
      s,
      s,
      s, // 6
      -s,
      s,
      s, // 7
    ]);

    const indices = new Uint32Array([
      // front
      0, 1, 2, 0, 2, 3,
      // back
      4, 6, 5, 4, 7, 6,
      // top
      3, 2, 6, 3, 6, 7,
      // bottom
      0, 5, 1, 0, 4, 5,
      // right
      1, 5, 6, 1, 6, 2,
      // left
      0, 3, 7, 0, 7, 4,
    ]);

    return { vertices, indices, id: this.id };
  }

  removeGeometry() {
    removeGeometry(this.id);
  }

  async execute() {
    const size = this.sizeControl.value ?? 1.0;

    // Update geometry if control changed
    this.geometry = this.createCubeGeometry(size);
    console.log("Cube node generated geometry:", this.geometry);

    addGeometry({
      vertices: new Float32Array(this.geometry.vertices),
      indices: new Uint32Array(this.geometry.indices),
      id: this.id
    });

    return { geometry: this.geometry };
  }
}