// src/components/engine/GraphEngine.ts
import { NodeEditor } from "rete";
import { addGeometry, removeGeometry } from "../geometry/geometry";
import {
  isExecutable,
  isModifier,
  isCombiner,
  isGenerator,
  isUpdatable,
} from "../types";
import { Schemes } from "../types";
import { IGeometryModifier } from "../interfaces/NodeCapabilities";

export class GraphEngine {
  constructor(private editor: NodeEditor<Schemes>) {}

  async propagate(sourceId: string) {
    const source = this.editor.getNode(sourceId);
    if (!source) return;

    const geometry = "geometry" in source ? (source as any).geometry : null;
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
        if (isExecutable(target)) await target.execute();
      }
    }
  }

  // Handle new connection logic
  async onConnectionCreated(connection: any) {
    const source = this.editor.getNode(connection.source);

    // TODO not getting updated rn when transform goes to transform
    if (source && isUpdatable(source)) {
      source.setUpdateCallback(() => this.propagate(source.id));
    }

    await this.propagate(connection.source);
  }

  // Handle cleanup logic
  async onConnectionRemoved(connection: any) {
    const target = this.editor.getNode(connection.target);
    const source = this.editor.getNode(connection.source);

    // 1. Reset Target (The Modifier)
    if (target && isModifier(target)) {
      target.inputGeometry = null;
      // target.isRemoved = true;
      // TODO sourceid 
      // removeGeometry(target.id); 
      console.log("Removing geometry: " + (target as any).sourceId + " " + target.id);
      removeGeometry((target as any).sourceId ?? target.id); 
      if (isExecutable(target)) await target.execute();
      // Force visual update if needed
      if (isUpdatable(target)) target.onUpdate?.();
    }

    // 2. Restore Source (The Original Shape)
    if (source && "geometry" in source && !source.isRemoved) {
      // source.isRemoved = true;
      const original = (source as any).geometry;
      removeGeometry(original.sourceId);
      if (original) {
        if (isModifier(source)) {
          // if ()
          // TODO I think something needs to be done here in order to address the case of deleting second transform in a chain cube->transform->transform
          // addGeometry(source.applyModification(source.inputGeometry));
          addGeometry(original);
        } else {
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
    if (isExecutable(node) && isGenerator(node)) {
      await node.execute();
    }
  }

  //Handle node deletion
  onNodeRemoved(node: any) {
    if (!node.isRemoved) {
      node.isRemoved = true;
      removeGeometry(node.id);
      // console.log(`nodeRemoved: ${node.id} ${node.isRemoved}`);
    }
  }

  // Helper to parse "geometry0", "geometry1"
  private getInputIndex(key: string): number {
    const match = key.match(/\d+/);
    return match ? parseInt(match[0]) : 0;
  }
}

/*
if (context.type === "nodecreate") {
      const createdNode = context.data;
      if (isExecutable(createdNode)) {
        await createdNode.execute();
      }
    } else if (context.type === "noderemove") {
      const node = context.data;
      removeGeometry(node.id);
    } else if (context.type === "connectioncreated") {
      const connection = context.data;

      if (!connectionMap.has(connection.source)) {
        connectionMap.set(connection.source, new Set());
      }
      connectionMap.get(connection.source)!.add(connection.target);

      const sourceNode = editor.getNode(connection.source);
      const targetNode = editor.getNode(connection.target);

      if (!sourceNode || !targetNode) {
        console.warn("Could not find nodes for connection:", connection);
        return;
      }

      console.log(
        "Connection established between:",
        sourceNode.label,
        "→",
        targetNode.label
      );

      if (isUpdatable(sourceNode)) {
        sourceNode.setUpdateCallback(() => {
          propagateUpdate(connection.source);
        });
      }

      if ("geometry" in sourceNode && (sourceNode as any).geometry) {
        const geom = (sourceNode as any).geometry;

        if (isGenerator(targetNode)) {
          targetNode.setInputGeometry(geom);
        } else if (isCombiner(targetNode)) {
          const indexMatch = connection.targetInput.match(/\d+/);
          const index = indexMatch ? parseInt(indexMatch[0]) : 0;
          (targetNode as any).setInputGeometry(index, geom);
          if (isExecutable(targetNode)) await targetNode.execute();
        }
      }
    } else if (context.type === "connectionremove") {
      const connection = context.data;
      console.log("Connection removed:", connection);

      const targetNode = editor.getNode(connection.target);
      const sourceNode = editor.getNode(connection.source);

      if (targetNode) {
        if (isModifier(targetNode)) {
          targetNode.inputGeometry = undefined;
          removeGeometry(targetNode.id);
          if (isExecutable(targetNode)) await targetNode.execute();
          if (isUpdatable(targetNode)) targetNode.onUpdate?.();
        }
      }

      if (sourceNode && "geometry" in sourceNode) {
        const originalGeometry = (sourceNode as any).geometry;

        if (originalGeometry) {
          removeGeometry(originalGeometry.id);
          addGeometry({
            vertices: originalGeometry.vertices,
            indices: originalGeometry.indices,
            id: originalGeometry.id,
          });
        }
      }
      console.log("Removed geometry for disconnected", targetNode.label);
    }

    return context;
*/
