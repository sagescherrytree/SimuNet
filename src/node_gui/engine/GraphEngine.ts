// src/components/engine/GraphEngine.ts
import { NodeEditor, Root } from "rete";
import { addGeometry, removeGeometry, geometries, clearGeometries, runAddSubscribers, nodesForGeometries, runRebuild } from "../geometry/geometry";
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
  constructor(private editor: NodeEditor<Schemes>) {}

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

    // TODO not getting updated rn when transform goes to transform
    if (source && isUpdatable(source)) {
      // console.log("set update callback");
      // console.log(source);
      // source.setUpdateCallback(async () => {
      //   await this.propagate(source.id)
      //   runRebuild();
      //   // nodesToGeometries();
      //   // this.updateAllGeometries()
      // }
      // );
    }

    await this.propagate(connection.source);
    // this.updateAllGeometries()
  }

  // Handle cleanup logic
  async onConnectionRemoved(connection: any) {
    const target = this.editor.getNode(connection.target);
    const source = this.editor.getNode(connection.source);

    // 1. Reset Target (The Modifier)
    // if (target && isModifier(target)) {
    //   target.inputGeometry = null;
    //   console.log("Reset target: " + (target as any).geometry.sourceId + " " + target.id);
    //   if (!source.isRemoved) {
    //     console.log("Removing geometry: " + (target as any).geometry.sourceId + " " + target.id);
    //     console.log(source);
    //     removeGeometry((target as any).sourceId ?? target.id); 
    //   }
    //   // target.isRemoved = true;
    //   // TODO sourceid 
    //   // removeGeometry(target.id); 
    //   // removeGeometry(target.id); 
    //   if (isExecutable(target)) await target.execute();
    //   // Force visual update if needed
    //   if (isUpdatable(target)) target.onUpdate?.();
    // }

    // 2. Restore Source (The Original Shape)
    if (source && "geometry" in source) {
      // TODO isremoved does nothing note
      // source.isRemoved = true;
      const original = (source as any).geometry;
      
      if (original) {
        if (isModifier(source)) {
          // if ()
          // TODO I think something needs to be done here in order to address the case of deleting second transform in a chain cube->transform->transform
          // addGeometry(source.applyModification(source.inputGeometry));
          console.log("Restore Source modifier: " + original.sourceId);
          removeGeometry(target.geometry.id); // TODO might need to remove geometry by sourceId?
          // addGeometry(original);
        } else {
          console.log("Restore Source non-modifier: " + original.sourceId);
          removeGeometry(target.geometry.id); // TODO might need to remove geometry by sourceId?
          // removeGeometry(original.sourceId); // TODO might need to remove geometry by sourceId?
          console.log("adding copy geometry");
          addGeometry(
            {
              vertices: new Float32Array(original.vertices),
              indices: new Uint32Array(original.indices),
              id: original.id,
              sourceId: original.sourceId ?? original.id
            }
          );
        }
      }
    }
  }

  //Handle node creation
  async onNodeCreated(node: any) {
    // if (isExecutable(node) && isGenerator(node)) {
    //   await node.execute();
    // }
    node.setUpdateCallback(async () => {
      await this.propagate(node.id)
      runRebuild();
    });
  }

  //Handle node deletion
  onNodeRemoved(node: any) {
    console.log(`Remove node called: ${node.id} ${node.isRemoved}`);
    if (!node.isRemoved) {
      node.isRemoved = true;
      console.log(`Removing node: ${node.id} ${node.isRemoved}`);
      removeGeometry(node.id);
    }
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
    // allConnections.push(); 
    if (context != null) {
      switch (context.type) {
        case "connectioncreated":
          // newConnections.push(context.data);
          // allConnections.push(context.data);
          break;
        case "connectionremove":
          // allConnections = allConnections.filter((conn) => conn.id !== context.data.id);
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
    let addThisOrChildren = (node: Node) => {
      const outConn = allConnections.filter(conn => conn.source === node.id);
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
    }
    for (let n of allNodes) {
      if (isGenerator(n)) {
        addThisOrChildren(n);
      }
    }
    console.log(nodesForGeometries);
    runRebuild()
    // nodesToGeometries();
  }
}