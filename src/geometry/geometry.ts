// src/geometry/geometry.ts.
export interface GeometryData {
    vertices: Float32Array;
    indices: Uint32Array;
}

const geometries: GeometryData[] = [];

// Test update geometry.
type GeometryCallback = (geom: GeometryData) => void;
const subscribers: GeometryCallback[] = [];

export function addGeometry(geom: GeometryData) {
    geometries.push(geom);
    subscribers.forEach(cb => cb(geom));
}

export function getGeometries() {
    return geometries;
}

export function clearGeometries() {
    geometries.length = 0;
}

export function onNewGeometry(geomCallBack: GeometryCallback) {
    subscribers.push(geomCallBack);
}
