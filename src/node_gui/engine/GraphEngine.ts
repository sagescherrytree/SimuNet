// src/components/engine/GraphEngine.ts
import { NodeEditor, Root } from "rete";
import {
  clearGeometries,
  nodesForGeometries,
  runRebuild,
} from "../geometry/geometry";
import {
  isExecutable,
  isModifier,
  isCombiner,
  isGenerator,
  isUpdatable,
  Node,
} from "../types";
import { Schemes } from "../types";
import { IGeometryModifier } from "../interfaces/NodeCapabilities";
import { Connection } from "../connections/Connection";

export class GraphEngine {
  constructor(private editor: NodeEditor<Schemes>) { }

  async propagate(sourceId: string) {
    const source = this.editor.getNode(sourceId);
    if (!source) return;

    const geometry = "geometry" in source ? source.geometry : null;
    if (!geometry) return;

    const connections = this.editor
      .getConnections()
      .filter((c) => c.source === sourceId);

    for (const conn of connections) {
      const target = this.editor.getNode(conn.target);
      if (!target) continue;

      if (isModifier(target)) {
        target.setInputGeometry(geometry);
        console.log(`Flow: ${source.label} -> ${target.label}`);
      } else if (isCombiner(target)) {
        const index = this.getInputIndex(conn.targetInput);
        // target.setInputGeometry(index, geometry);

        if (isExecutable(target)) {
          console.log("executing:");
          console.log(target);
          await target.execute();
        }
      }
      await this.propagate(target.id); // TODO is await needed?
    }
  }

  // Handle new connection logic
  async onConnectionCreated(connection: any) {
    const source = this.editor.getNode(connection.source);

    await this.propagate(connection.source);
  }

  //Handle node creation
  async onNodeCreated(node: any) {
    node.setUpdateCallback(async () => {
      await this.propagate(node.id);
      runRebuild();
    });
  }

  // Helper to parse "geometry0", "geometry1"
  private getInputIndex(key: string): number {
    const match = key.match(/\d+/);
    return match ? parseInt(match[0]) : 0;
  }

  updateAllGeometries(context: Root<Schemes> | null) {
    console.log("updating geometry");
    let allNodes = this.editor.getNodes();
    let allConnections = this.editor.getConnections();
    if (context != null) {
      switch (context.type) {
        case "connectioncreated":
          break;
        case "connectionremove":
          allConnections = allConnections.filter((conn) => conn.id !== context.data.id);
          break;
        case "nodecreate":
          // if (isGenerator(context.data)) {
          allNodes.push(context.data);
          // }
          break;
        case "noderemove":
          allNodes = allNodes.filter((node) => node.id !== context.data.id);
          break;
      }
    }

    clearGeometries();
    console.log("Updating node->geometry");
    console.log(allNodes);
    nodesForGeometries.length = 0;
    // TODO note if we ever add nodes with more than one input, or that somehow count as a base geometry while also having an input, then need to make sure to add a check to avoid looping in tree. as is, there's no way to have a base geometry lead to a loop
    let addThisOrChildren = (node: Node) => {
      const outConn = allConnections.filter((conn) => conn.source === node.id);
      if (outConn.length === 0) {
        console.log("Adding node: ");
        console.log(node);
        nodesForGeometries.push(node);
      } else {
        for (let c of outConn) {
          const target = this.editor.getNode(c.target);
          addThisOrChildren(target);
        }
      }
    };
    for (let n of allNodes) {
      if (isGenerator(n)) {
        addThisOrChildren(n);
      }
    }
    console.log(nodesForGeometries);
    runRebuild();
  }
}
