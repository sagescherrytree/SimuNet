// src/geometry/geometry.ts.
export interface GeometryData {
  vertices: Float32Array;
  indices: Uint32Array;
  id: string;
  sourceId?: string;
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

// export function nodesToGeometries() {
//   // removing--just do in getgeometries? so don't have update issues
//   clearGeometries();
//   for (const n of nodesForGeometries) {
//     if (n.geometry) {
//       geometries.push(n.geometry);
//     }
//   }
//   // addSubscribers.forEach((cb) => cb(null)); // TODO passing null; callback doesn't actually use value so should just remove (not passing in geometry from each node to avoid redundant rebuilding)
// }

export function addGeometry(geom: GeometryData) {
  // removeGeometry(geom.sourceId ?? geom.id);
  geometries.push(geom);
  addSubscribers.forEach((cb) => cb(geom));
}

export function runAddSubscribers(geom: GeometryData) {
  addSubscribers.forEach((cb) => cb(geom));
}

export function getGeometries() {
  geometries.length = 0;
  for (const n of nodesForGeometries) {
    if (n.geometry) {
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

export function addRebuildSubscriber(callback: (() => void)) {
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



