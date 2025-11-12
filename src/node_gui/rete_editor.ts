// src/components/index.ts
import { createRoot } from "react-dom/client";
import { NodeEditor } from "rete";
import { AreaPlugin, AreaExtensions } from "rete-area-plugin";
import {
  ConnectionPlugin,
  Presets as ConnectionPresets,
} from "rete-connection-plugin";
import { ReactPlugin, Presets } from "rete-react-plugin";
import {
  AutoArrangePlugin,
  Presets as ArrangePresets,
} from "rete-auto-arrange-plugin";
import {
  ContextMenuPlugin,
  Presets as ContextMenuPresets,
} from "rete-context-menu-plugin";


import {
  Schemes,
  AreaExtra,
  NodeTypes,
  CubeNode,
  TransformNode,
  IcosphereNode,
} from "./types";

import { Node } from "./types";

function getContextMenuItems() {
  const items = [...Object.entries(NodeTypes)];

  return items;
}

export const connectionMap = new Map<string, Set<string>>();

export async function createEditor(
  container: HTMLElement,
  onNodeSelected: (node: Node | null) => void
) {
  const editor = new NodeEditor<Schemes>();
  const area = new AreaPlugin<Schemes, AreaExtra>(container);
  const connection = new ConnectionPlugin<Schemes, AreaExtra>();
  const render = new ReactPlugin<Schemes, AreaExtra>({ createRoot });
  const arrange = new AutoArrangePlugin<Schemes>();

  const contextMenu = new ContextMenuPlugin<Schemes>({
    items: ContextMenuPresets.classic.setup(getContextMenuItems()),
  });

  area.use(contextMenu);

  const selector = AreaExtensions.selector();
  const accumulating = AreaExtensions.accumulateOnCtrl();

  AreaExtensions.selectableNodes(area, selector, {
    accumulating,
  });

  let currentSelectedNode: Node | null = null;

  function propagateUpdate(nodeId: string) {
    // const targetIds = connectionMap.get(nodeId);
    // if (!targetIds || targetIds.size == 0) return;

    const connections = editor.getConnections();
    const outgoingConnections = connections.filter(
      (connection) => connection.source === nodeId
    );
    const targetIds = outgoingConnections.map(
      (connection) => connection.target
    );

    if (!targetIds || targetIds.length == 0) return;

    const sourceNode = editor.getNode(nodeId);
    if (!sourceNode) return;

    // Get output geometry from source
    let outputGeometry;
    if ("geometry" in sourceNode) {
      outputGeometry = (sourceNode as any).geometry;
    }

    // Update all connected targets
    for (const targetId of targetIds) {
      const targetNode = editor.getNode(targetId);
      if (!targetNode) continue;

      if ("setInputGeometry" in targetNode && outputGeometry) {
        (targetNode as any).setInputGeometry(outputGeometry);

        console.log(
          "Propagated update:",
          sourceNode.label,
          "→",
          targetNode.label
        );

        // Recursively propagate to next nodes in chain
        // propagateUpdate(targetId);
        if ("onUpdate" in targetNode) {
          (targetNode as any).onUpdate();
        }
      }
    }
  }

  area.addPipe((context) => {
    // Selecting a node
    if (context.type === "nodepicked") {
      const nodeId = context.data.id;
      const node = editor.getNode(nodeId);

      currentSelectedNode = node as Node;
      onNodeSelected(currentSelectedNode);
      console.log("Selected node:", currentSelectedNode);
    }

    // Unselecting a node
    if (context.type === "pointerdown") {
      const target = context.data.event.target;
      if (
        target === container ||
        (target as HTMLElement).closest(".rete-container")
      ) {
        setTimeout(() => {
          const selectedNodes = editor
            .getNodes()
            .filter((n) => selector.isSelected(n));
          if (selectedNodes.length === 0) {
            currentSelectedNode = null;
            onNodeSelected(null);
            console.log("Deselected all nodes");
          }
        }, 0);
      }
    }

    return context;
  });

  render.addPreset(Presets.contextMenu.setup());
  render.addPreset(Presets.classic.setup());
  // TODO does vertical setup need CSS to do manually? I'm certain there must be some way to do on TS side
  // render.addPreset(Presets.classic.setup({
  //   socketPositionWatcher: getDOMSocketPosition({
  //     offset({x,y}, nodeId, side, key) {
  //       return {
  //         x: x,
  //         y: y + 100 * (side === "input" ? -1 : 1)
  //       }
  //     }
  //   })
  // }));

  // connection.
  connection.addPreset(ConnectionPresets.classic.setup());

  arrange.addPreset(ArrangePresets.classic.setup());
  // arrange.layout({options: {direction: "DOWN"}});

  editor.use(area);
  area.use(connection);
  area.use(render);

  area.use(arrange);

  AreaExtensions.simpleNodesOrder(area);

  editor.addPipe(async (context) => {
    if (context.type === "nodecreate") {
      const createdNode = context.data;
      if (createdNode instanceof CubeNode || createdNode instanceof IcosphereNode) {
        await createdNode.execute();
      }
    } else if (context.type === "noderemove") {
      const node = context.data;
      if (node instanceof CubeNode || node instanceof IcosphereNode) {
        node.removeGeometry();
      }
      // TODO transform remove here
    } else if (context.type === "connectioncreated") {
      const connection = context.data;

      if (!connectionMap.has(connection.source)) {
        connectionMap.set(connection.source, new Set());
      }
      connectionMap.get(connection.source)!.add(connection.target);

      // setTimeout(() => {
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

      if ("setUpdateCallback" in sourceNode) {
        (sourceNode as any).setUpdateCallback(() => {
          propagateUpdate(connection.source);
        });
      }

      // Example of passing geometry
      if (
        // sourceNode.label === "CubeNode" &&
        targetNode instanceof TransformNode
      ) {
        if (targetNode.inputGeometry) {
          targetNode.applyTransform(targetNode.inputGeometry);
        }
        const geom = (sourceNode as any).geometry;
        if (geom) {
          console.log("Passing geometry to TransformNode", geom);
          targetNode.setInputGeometry?.(geom);
        }
      }
      // }, 0);
    } else if (context.type === "connectionremove") {
      const connection = context.data;
      console.log("Connection removed:", connection);

      const targetNode = editor.getNode(connection.target);
      const sourceNode = editor.getNode(connection.source);

      if (targetNode) {
      }
      // Remove the transformed output when connection is broken
      if (targetNode instanceof TransformNode) {
        targetNode.removeNode(sourceNode);
      }
      console.log("Removed geometry for disconnected", targetNode.label);
    }

    return context;
  });

  await arrange.layout();
  AreaExtensions.zoomAt(area, editor.getNodes());

  return { editor, destroy: () => area.destroy() };
}
