// src/types.ts
import { ClassicPreset, GetSchemes } from "rete";
import { Connection } from "./connections/Connection";
import { Node } from "./nodes/Node";
import { CubeNode } from "./nodes/CubeNode";
import { TransformNode } from "./nodes/TransformNode";

export type Schemes = GetSchemes<Node, Connection<Node, Node>>;

export type AreaExtra = any;

export const socket = new ClassicPreset.Socket("socket");

export const NodeTypes = {
  CubeNode: () => new CubeNode(),
  NodeB: () => new TransformNode(),
};

export { Node, CubeNode, TransformNode };
