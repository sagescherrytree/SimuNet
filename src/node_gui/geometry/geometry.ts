// src/geometry/geometry.ts.
import { GPUContext } from "../../webgpu/GPUContext";

// Place arrays into a buffer.
export interface GeometryData {
  vertices: Float32Array; // TODO move these to GPU <- will no longer use these, delete later
  indices: Uint32Array; // TODO move to buffer.
  normals?: Float32Array; // TODO move to buffer.
  wireframeIndices?: Uint32Array;
  wireframeIndexBuffer?: GPUBuffer;

  // buffer VertexBuffer.
  // buffer IndexBuffer.
  vertexBuffer?: GPUBuffer; // vertex positions + normal
  indexBuffer?: GPUBuffer; // Indices.

  id: string;
  sourceId?: string;
  boundingSphere?: {
    center: [number, number, number];
    radius: number;
  };
  boundingBox?: {
    min: [number, number, number];
    max: [number, number, number];
  };
}

import { Node } from "../types";
let geometries: GeometryData[] = [];
let nodesForGeometries: Node[] = [];
export { geometries, nodesForGeometries };

// Test update geometry.
type GeometryCallback = (geom: GeometryData) => void;
type GeometryRemoveCallback = (id: string) => void;

// TODO I think don't need as arrays anymore since just one per scene? also the id isn't used for anything
const addSubscribers: GeometryCallback[] = [];
const rebuildSubscribers: (() => void)[] = [];
const removeSubscribers: GeometryRemoveCallback[] = [];

export function addGeometry(geom: GeometryData) {
  geometries.push(geom);
  addSubscribers.forEach((cb) => cb(geom));
}

export function runAddSubscribers(geom: GeometryData) {
  addSubscribers.forEach((cb) => cb(geom));
}

export function getGeometries() {
  geometries.length = 0;
  for (const n of nodesForGeometries) {
    if (n.geometry && n.outputEnabled) {
      geometries.push(n.geometry);
    }
  }
  console.log(geometries);
  return geometries;
}

export function clearGeometries() {
  geometries.length = 0;
  removeSubscribers.forEach((cb) => cb("all"));
}

export function removeGeometry(id: string) {
  const prevLength = geometries.length;
  console.log("Removing ID: " + id);
  geometries = geometries.filter((x) => x.id !== id);
  if (geometries.length < prevLength) {
    console.log(removeSubscribers);
    removeSubscribers.forEach((cb) => cb(id));
    console.log("removeSubscribers ran");
  }
}

export function removeTransform(sourceId: string) {
  removeGeometry(sourceId);
}

export function onNewGeometry(geomCallBack: GeometryCallback) {
  addSubscribers.push(geomCallBack);
}

export function runRebuild() {
  rebuildSubscribers.forEach((cb) => cb());
}

export function addRebuildSubscriber(callback: () => void) {
  rebuildSubscribers.push(callback);
}

export function onGeometryRemoved(geomCallBack: GeometryRemoveCallback) {
  removeSubscribers.push(geomCallBack);
}

export function updateGeometry(id: string, newVertices: Float32Array) {
  const geom = geometries.find((g) => g.id === id);
  if (!geom) return;

  geom.vertices = newVertices;
  addSubscribers.forEach((cb) => cb(geom)); // triggers renderer update
}

export function generateWireframeIndices(
  triangleIndices: Uint32Array
): Uint32Array {
  const edges = new Set<string>();
  const lineIndices: number[] = [];

  for (let i = 0; i < triangleIndices.length; i += 3) {
    const i0 = triangleIndices[i];
    const i1 = triangleIndices[i + 1];
    const i2 = triangleIndices[i + 2];

    const edge1 = `${Math.min(i0, i1)}-${Math.max(i0, i1)}`;
    const edge2 = `${Math.min(i1, i2)}-${Math.max(i1, i2)}`;
    const edge3 = `${Math.min(i2, i0)}-${Math.max(i2, i0)}`;

    if (!edges.has(edge1)) {
      edges.add(edge1);
      lineIndices.push(i0, i1);
    }
    if (!edges.has(edge2)) {
      edges.add(edge2);
      lineIndices.push(i1, i2);
    }
    if (!edges.has(edge3)) {
      edges.add(edge3);
      lineIndices.push(i2, i0);
    }
  }

  return new Uint32Array(lineIndices);
}

export function calculateBounds(vertices: number[]): {
  sphere: { center: [number, number, number]; radius: number };
  box: { min: [number, number, number]; max: [number, number, number] };
} {
  if (vertices.length === 0) {
    return {
      sphere: { center: [0, 0, 0], radius: 0 },
      box: { min: [0, 0, 0], max: [0, 0, 0] },
    };
  }

  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;


  // TODO GPU-side?
  // Find bounding box
  for (let i = 0; i < vertices.length; i += 3) {
    minX = Math.min(minX, vertices[i]);
    minY = Math.min(minY, vertices[i + 1]);
    minZ = Math.min(minZ, vertices[i + 2]);
    maxX = Math.max(maxX, vertices[i]);
    maxY = Math.max(maxY, vertices[i + 1]);
    maxZ = Math.max(maxZ, vertices[i + 2]);
  }

  // Calculate bounding sphere
  const center: [number, number, number] = [
    (minX + maxX) / 2,
    (minY + maxY) / 2,
    (minZ + maxZ) / 2,
  ];

  // Find max distance from center to any vertex
  let maxDistSq = 0;
  for (let i = 0; i < vertices.length; i += 3) {
    const dx = vertices[i] - center[0];
    const dy = vertices[i + 1] - center[1];
    const dz = vertices[i + 2] - center[2];
    const distSq = dx * dx + dy * dy + dz * dz;
    maxDistSq = Math.max(maxDistSq, distSq);
  }

  return {
    sphere: { center, radius: Math.sqrt(maxDistSq) },
    box: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
  };
}
