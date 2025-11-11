// src/types.ts
import { ClassicPreset, GetSchemes } from "rete";
import { Connection } from "./connections/Connection";
import { Node } from "./nodes/Node";
import { NodeA } from "./nodes/NodeA";
import { NodeB } from "./nodes/NodeB";

export type Schemes = GetSchemes<Node, Connection<Node, Node>>;

export type AreaExtra = any;

export const socket = new ClassicPreset.Socket("socket");

export const NodeTypes = {
  NodeA: () => new NodeA(),
  NodeB: () => new NodeB(),
};

export { Node, NodeA, NodeB };
