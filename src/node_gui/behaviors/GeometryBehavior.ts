import {
  addGeometry,
  removeGeometry,
  GeometryData,
} from "../geometry/geometry";

/**
 * Composable behavior for managing geometry lifecycle
 */
export class GeometryBehavior {
  constructor(private nodeId: string) {}

  addGeometry(geometry: GeometryData) {
    addGeometry({
      id: this.nodeId,
      sourceId: geometry.sourceId ?? this.nodeId,
    });
  }

  removeGeometry() {
    removeGeometry(this.nodeId);
  }


}
