import { Node } from "./Node";
import { GeometryData } from "../geometry/geometry";
import { NumberControl } from "../controls/NumberControl";
import { Vec3Control } from "../controls/Vec3Control";
import { IGeometryGenerator } from "../interfaces/NodeCapabilities";

export class CubeNode extends Node implements IGeometryGenerator {
  height = 100;
  width = 200;

  sizeControl: NumberControl;
  positionControl: Vec3Control;

  constructor() {
    super("CubeNode");

    this.ioBehavior.addGeometryOutput();

    const update = () => {
      this.execute();
      this.updateBehavior.triggerUpdate();
    };

    this.sizeControl = new NumberControl("Size", 1.0, update);

    this.positionControl = new Vec3Control(
      "Position",
      { x: 0, y: 0, z: 0 },
      update
    );

    this.geometry = this.generateGeometry();
  }

  generateGeometry(): GeometryData {
    const size = this.sizeControl.value ?? 1.0;
    const s = size / 2;
    const pos = this.positionControl.value;

    const baseVertices = [
      [-s, -s, -s], // 0
      [s, -s, -s], // 1
      [s, s, -s], // 2
      [-s, s, -s], // 3
      [-s, -s, s], // 4
      [s, -s, s], // 5
      [s, s, s], // 6
      [-s, s, s], // 7
    ];

    const transformedVertices: number[] = [];
    for (const [x, y, z] of baseVertices) {
      transformedVertices.push(x + pos.x, y + pos.y, z + pos.z);
    }

    const indices = new Uint32Array([
      // front
      0, 2, 1, 0, 3, 2,
      // back
      4, 5, 6, 4, 6, 7,
      // top
      3, 6, 2, 3, 7, 6,
      // bottom
      0, 1, 5, 0, 5, 4,
      // right
      1, 6, 5, 1, 2, 6,
      // left
      0, 7, 3, 0, 4, 7,
    ]);

    return {
      vertices: new Float32Array(transformedVertices),
      indices,
      id: this.id,
      sourceId: this.id,
    };
  }

  async execute() {
    // Update geometry if control changed
    this.geometry = this.generateGeometry();
    console.log("Cube node generated geometry:", this.geometry);


    return { geometry: this.geometry };
  }

  getEditableControls() {
    return {
      size: this.sizeControl,
      position: this.positionControl,
    };
  }
}
