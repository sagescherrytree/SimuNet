import {
  addGeometry,
  removeGeometry,
  updateGeometry,
  GeometryData,
} from "../geometry/geometry";

/**
 * Composable behavior for managing geometry lifecycle
 */
export class GeometryBehavior {
  constructor(private nodeId: string) {}

  addGeometry(geometry: GeometryData) {
    addGeometry({
      vertices: new Float32Array(geometry.vertices),
      indices: new Uint32Array(geometry.indices),
      id: this.nodeId,
    });
  }

  removeGeometry() {
    removeGeometry(this.nodeId);
  }

  updateGeometry(sourceId: string, vertices: Float32Array) {
    updateGeometry(sourceId, vertices);
  }
}
