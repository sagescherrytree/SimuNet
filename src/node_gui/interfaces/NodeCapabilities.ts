import { GeometryData } from "../../geometry/geometry";

export interface IExecutable {
  execute(inputs?: Record<string, any>): Promise<any>;
}

export interface IGeometryGenerator {
  generateGeometry(): GeometryData;
  geometry: GeometryData;
}

export interface IGeometryModifier {
  applyModification(input: GeometryData): GeometryData | undefined;
  inputGeometry?: GeometryData;
  setInputGeometry(geometry: GeometryData): void;
}

export interface IVertexDeformer {
  deformVertices(vertices: Float32Array): Float32Array;
}

export interface IAttributeCalculator {
  calculateAttributes(geometry: GeometryData): any;
}

export interface IGeometryCombiner {
  combineGeometries(geometries: GeometryData[]): GeometryData;
}

export interface IUpdatable {
  onUpdate?: () => void;
  setUpdateCallback(callback: () => void): void;
}

export interface IControllable {
  getEditableControls(): Record<string, any>;
}
