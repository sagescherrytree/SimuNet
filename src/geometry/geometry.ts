// src/geometry/geometry.ts.
export interface GeometryData {
    vertices: Float32Array;
    indices: Uint32Array;
}

const geometries: GeometryData[] = [];

export function addGeometry(geom: GeometryData) {
    geometries.push(geom);
}

export function getGeometries() {
    return geometries;
}

export function clearGeometries() {
    geometries.length = 0;
}
