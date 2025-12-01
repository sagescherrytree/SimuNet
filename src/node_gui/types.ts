// src/types.ts
import { ClassicPreset, GetSchemes } from "rete";
import { Connection } from "./connections/Connection";
import { Node } from "./nodes/Node";
import { CubeNode } from "./nodes/CubeNode";
import { IcosphereNode } from "./nodes/IcosphereNode";
import { TransformNode } from "./nodes/TransformNode";
import { NoiseNode } from "./nodes/NoiseNode";
import { ClothNode } from "./nodes/ClothNode";
import {
  IExecutable,
  IGeometryModifier,
  IGeometryCombiner,
  IGeometryGenerator,
  IUpdatable,
} from "./interfaces/NodeCapabilities";
import { PlaneNode } from "./nodes/PlaneNode";
import { TorusNode } from "./nodes/TorusNode";
import { RecomputeNormalsNode } from "./nodes/RecomputeNormalsNode";
import { MaterialNode } from "./nodes/MaterialNode";

export type Schemes = GetSchemes<Node & { node: Node }, Connection<Node, Node>>;

export type AreaExtra = any;

export const socket = new ClassicPreset.Socket("socket");

type NodeConstructor<T extends Node> = new (...args: any[]) => T;

function createThematicNode<T extends Node>(NodeClass: NodeConstructor<T>) {
  return () => {
    const nodeInstance = new NodeClass();

    const nodeData = Object.assign(nodeInstance, {
      node: nodeInstance,
    }) as Node & { node: Node };

    return nodeData;
  };
}

export const NodeTypes = {
  Cube: createThematicNode(CubeNode),
  Icosphere: createThematicNode(IcosphereNode),
  Transform: createThematicNode(TransformNode),
  Noise: createThematicNode(NoiseNode),
  Cloth: createThematicNode(ClothNode),
  Plane: createThematicNode(PlaneNode),
  Torus: createThematicNode(TorusNode),
  RecomputeNormals: createThematicNode(RecomputeNormalsNode),
  Material: createThematicNode(MaterialNode),
};

export const isExecutable = (n: any): n is IExecutable =>
  n && typeof (n as any).execute === "function";

export const isModifier = (n: any): n is IGeometryModifier =>
  n && typeof (n as any).applyModification === "function";

export const isCombiner = (n: any): n is IGeometryCombiner =>
  n && typeof (n as any).combineGeometries === "function";

export const isGenerator = (n: any): n is IGeometryGenerator =>
  n && typeof (n as any).generateGeometry === "function";

export const isUpdatable = (n: any): n is IUpdatable =>
  n && typeof (n as any).setUpdateCallback === "function";

export { Node, CubeNode, IcosphereNode, TransformNode, NoiseNode, ClothNode, PlaneNode, TorusNode, RecomputeNormalsNode, MaterialNode };
