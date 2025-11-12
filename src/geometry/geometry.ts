// src/geometry/geometry.ts.
export interface GeometryData {
    vertices: Float32Array;
    indices: Uint32Array;
    id: string;
}

let geometries: GeometryData[] = [];

// Test update geometry.
type GeometryCallback = (geom: GeometryData) => void;
type GeometryRemoveCallback = (id: string) => void;

const addSubscribers: GeometryCallback[] = [];
const removeSubscribers: GeometryRemoveCallback[] = [];

export function addGeometry(geom: GeometryData) {
    geometries.push(geom);
    addSubscribers.forEach(cb => cb(geom));
}

export function getGeometries() {
    return geometries;
}

export function clearGeometries() {
    geometries.length = 0;
    removeSubscribers.forEach(cb => cb("all"));
}

export function removeGeometry(id: string) {
    const prevLength = geometries.length;
    geometries = geometries.filter((x) => x.id !== id);

    if (geometries.length < prevLength) {
        removeSubscribers.forEach(cb => cb(id));
    }
}

export function onNewGeometry(geomCallBack: GeometryCallback) {
    addSubscribers.push(geomCallBack);
}

export function onGeometryRemoved(geomCallBack: GeometryRemoveCallback) {
    removeSubscribers.push(geomCallBack);
}

export function updateGeometry(id: string, newVertices: Float32Array) {
    const geom = geometries.find(g => g.id === id);
    if (!geom) return;

    geom.vertices = newVertices;
    addSubscribers.forEach(cb => cb(geom)); // triggers renderer update
}
