// src/types.ts
import { ClassicPreset, GetSchemes } from "rete";
import { Connection } from "./connections/Connection";
import { Node } from "./nodes/Node";
import { CubeNode } from "./nodes/CubeNode";
import { IcosphereNode } from "./nodes/IcosphereNode";
import { TransformNode } from "./nodes/TransformNode";

export type Schemes = GetSchemes<Node, Connection<Node, Node>>;

export type AreaExtra = any;

export const socket = new ClassicPreset.Socket("socket");

export const NodeTypes = {
  CubeNode: () => new CubeNode(),
  IcosphereNode: () => new IcosphereNode(),
  TransformNode: () => new TransformNode(),
};

export { Node, CubeNode, IcosphereNode, TransformNode };
