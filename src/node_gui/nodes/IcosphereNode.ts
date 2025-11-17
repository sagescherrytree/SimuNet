import { Node } from "./Node";
import { GeometryData } from "../../geometry/geometry";
import { NumberControl } from "../controls/NumberControl";
import { Vec3Control } from "../controls/Vec3Control";
import { IGeometryGenerator } from "../interfaces/NodeCapabilities";

export class IcosphereNode extends Node implements IGeometryGenerator {
  height = 100;
  width = 200;

  public geometry: GeometryData;
  sizeControl: NumberControl;
  subdivisionsControl: NumberControl;
  positionControl: Vec3Control;

  constructor() {
    super("IcosphereNode");

    this.ioBehavior.addGeometryOutput();

    const update = () => {
      this.geometryBehavior.removeGeometry();
      this.execute();
      this.updateBehavior.triggerUpdate();
    };

    this.sizeControl = new NumberControl("Size", 1.0, update);
    this.subdivisionsControl = new NumberControl(
      "Subdivisions",
      2.0,
      update,
      1.0,
      0,
      5
    );

    this.positionControl = new Vec3Control(
      "Position",
      { x: 0, y: 0, z: 0 },
      update
    );

    this.geometry = this.generateGeometry();
  }

  generateGeometry(): GeometryData {
    const size = this.sizeControl.value ?? 1.0;
    const subdivisions = this.subdivisionsControl.value ?? 2.0;

    const phi = (1 + Math.sqrt(5.0)) * 0.5;
    const s = size / 2;
    const pos = this.positionControl.value;

    const Z = 1.0;
    const X = 1.0 / phi;
    const baseVertices = [
      [-X, 0, Z],
      [X, 0, Z],
      [-X, 0, -Z],
      [X, 0, -Z],
      [0, Z, X],
      [0, Z, -X],
      [0, -Z, X],
      [0, -Z, -X],
      [Z, X, 0],
      [-Z, X, 0],
      [Z, -X, 0],
      [-Z, -X, 0],
    ];

    for (let i = 0; i < baseVertices.length; ++i) {
      let len = 0;
      for (let j = 0; j < 3; ++j) {
        len += baseVertices[i][j] * baseVertices[i][j];
      }
      let divisor = Math.sqrt(len);
      for (let j = 0; j < 3; ++j) {
        baseVertices[i][j] /= divisor;
      }
    }

    let triIndices = [
      0, 1, 4, 0, 4, 9, 9, 4, 5, 4, 8, 5, 4, 1, 8, 8, 1, 10, 8, 10, 3, 5, 8, 3,
      5, 3, 2, 2, 3, 7, 7, 3, 10, 7, 10, 6, 7, 6, 11, 11, 6, 0, 0, 6, 1, 6, 10,
      1, 9, 11, 0, 9, 2, 11, 9, 5, 2, 7, 11, 2,
    ];

    const triSplitMap = new Map<string, number>();
    function midpoint(idx0: number, idx1: number): number {
      let key = [idx0, idx1].sort().join("_");
      if (!triSplitMap.has(key)) {
        let newVert = [...baseVertices[idx0]];
        let sum = 0;
        for (let i = 0; i < 3; ++i) {
          newVert[i] = (newVert[i] + baseVertices[idx1][i]) * 0.5;
          sum += newVert[i] * newVert[i];
        }
        let len = Math.sqrt(sum);
        for (let i = 0; i < 3; ++i) {
          newVert[i] /= len;
        }
        triSplitMap.set(key, baseVertices.length);
        baseVertices.push(newVert);
      }
      return triSplitMap.get(key);
    }

    for (let i = 0; i < subdivisions; ++i) {
      const newTriangles = [];
      for (let j = 0; j < triIndices.length; j += 3) {
        let v0 = triIndices[j];
        let v1 = triIndices[j + 1];
        let v2 = triIndices[j + 2];

        let v01 = midpoint(v0, v1);
        let v02 = midpoint(v0, v2);
        let v12 = midpoint(v1, v2);

        // TODO rotation direction
        newTriangles.push(v0, v01, v02);
        newTriangles.push(v1, v12, v01);
        newTriangles.push(v2, v02, v12);
        newTriangles.push(v01, v12, v02);
      }
      triIndices = newTriangles;
    }

    const indices = new Uint32Array(triIndices);

    const transformedVertices: number[] = [];
    for (const [x, y, z] of baseVertices) {
      transformedVertices.push(s * x + pos.x, s * y + pos.y, s * z + pos.z);
    }

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
    console.log("Icosphere node generated geometry:", this.geometry);

    this.geometryBehavior.addGeometry(this.geometry);

    return { geometry: this.geometry };
  }

  getEditableControls() {
    return {
      size: this.sizeControl,
      subdivisions: this.subdivisionsControl,
      position: this.positionControl,
    };
  }
}
