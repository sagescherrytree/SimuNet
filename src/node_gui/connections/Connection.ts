// src/components/connections/Connection.ts
import { ClassicPreset } from "rete";
import { Node } from "../nodes/Node";

export class Connection<
  A extends Node,
  B extends Node
> extends ClassicPreset.Connection<A, B> {}
