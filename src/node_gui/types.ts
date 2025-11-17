// src/types.ts
import { ClassicPreset, GetSchemes } from "rete";
import { Connection } from "./connections/Connection";
import { Node } from "./nodes/Node";
import { CubeNode } from "./nodes/CubeNode";
import { IcosphereNode } from "./nodes/IcosphereNode";
import { TransformNode } from "./nodes/TransformNode";
import { NoiseNode } from "./nodes/NoiseNode";
import {
  IExecutable,
  IGeometryModifier,
  IGeometryCombiner,
  IGeometryGenerator,
  IUpdatable,
} from "./interfaces/NodeCapabilities";

export type Schemes = GetSchemes<Node, Connection<Node, Node>>;

export type AreaExtra = any;

export const socket = new ClassicPreset.Socket("socket");

export const NodeTypes = {
  CubeNode: () => new CubeNode(),
  IcosphereNode: () => new IcosphereNode(),
  TransformNode: () => new TransformNode(),
  NoiseNode: () => new NoiseNode(),
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

export { Node, CubeNode, IcosphereNode, TransformNode, NoiseNode };
