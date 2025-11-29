// src/components/index.ts
import { createRoot } from "react-dom/client";
import { NodeEditor } from "rete";
import { AreaPlugin, AreaExtensions } from "rete-area-plugin";
import {
  ConnectionPlugin,
  Presets as ConnectionPresets,
} from "rete-connection-plugin";
import { ReactPlugin, Presets } from "rete-react-plugin";
import { getDOMSocketPosition } from "rete-render-utils";
import {
  AutoArrangePlugin,
  Presets as ArrangePresets,
} from "rete-auto-arrange-plugin";
import {
  ContextMenuPlugin,
  Presets as ContextMenuPresets,
} from "rete-context-menu-plugin";
import { Schemes, AreaExtra, NodeTypes } from "./types";
import { GraphEngine } from "./engine/GraphEngine";
import { Node } from "./types";
import { CustomNode } from "./components/CustomNode";
import { CustomConnection } from "./components/CustomConnection";
import { CustomSocket } from "./components/CustomSocket";

type ContextMenuItem = [string, () => Schemes["Node"]];

function getContextMenuItems() {
  const { Cube, Icosphere, Noise, Transform, Cloth, Plane, Torus } = NodeTypes;

  const primitiveItems: ContextMenuItem[] = [
    ["Cube", Cube],
    ["Icosphere", Icosphere],
    ["Plane", Plane],
    ["Torus", Torus],
  ];

  const deformationItems: ContextMenuItem[] = [
    ["Noise", Noise],
    ["Transform", Transform],
    ["Cloth", Cloth],
  ];

  primitiveItems.sort((a, b) => a[0].localeCompare(b[0]));
  deformationItems.sort((a, b) => a[0].localeCompare(b[0]));

  const items = [
    ["Geometry", primitiveItems],
    ["Modify", deformationItems],
  ];

  return items as any;
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

  const engine = new GraphEngine(editor);

  const contextMenu = new ContextMenuPlugin<Schemes>({
    items: ContextMenuPresets.classic.setup(getContextMenuItems()),
  });

  area.use(contextMenu);

  setupSelection(area, editor, onNodeSelected);

  render.addPreset(Presets.contextMenu.setup());
  render.addPreset(
    Presets.classic.setup({
      customize: {
        node() {
          return CustomNode;
        },
        connection() {
          return CustomConnection;
        },
        socket() {
          return CustomSocket;
        },
      },
      socketPositionWatcher: getDOMSocketPosition({
        offset({ x, y }, nodeId, side) {
          // FIX: Reduce offset to 10px to match the vertical positioning better.
          return {
            x: x + (side === "input" || side === "output" ? -18 : 0),
            y: y + 20 * (side === "input" ? -1 : 1), // Using 10px
          };
        },
      }),
    })
  );

  // connection.
  connection.addPreset(ConnectionPresets.classic.setup());

  arrange.addPreset(ArrangePresets.classic.setup());

  editor.use(area);
  area.use(connection);
  area.use(render);

  area.use(arrange);

  AreaExtensions.simpleNodesOrder(area);

  editor.addPipe(async (context) => {
    switch (context.type) {
      case "nodecreate":
        await engine.onNodeCreated(context.data);
        engine.updateAllGeometries(context);
        break;
      case "connectioncreated":
        await engine.onConnectionCreated(context.data);
        engine.updateAllGeometries(context);
        break;
      case "connectionremove":
      case "noderemove":
        engine.updateAllGeometries(context);
        break;
    }

    return context;
  });

  await arrange.layout();
  AreaExtensions.zoomAt(area, editor.getNodes());

  const getNodeById = (id: string) => {
    return editor.getNode(id);
  };

  return {
    editor,
    destroy: () => { },
    getNodeById,
    engine
  };
}

function setupSelection(
  area: AreaPlugin<any, any>,
  editor: NodeEditor<any>,
  onSelect: (n: Node | null) => void
) {
  const selector = AreaExtensions.selector();
  const accumulating = AreaExtensions.accumulateOnCtrl();

  AreaExtensions.selectableNodes(area, selector, { accumulating });

  area.addPipe((context) => {
    if (context.type === "nodepicked") {
      onSelect(editor.getNode(context.data.id));
    }
    if (context.type === "pointerdown") {
      const target = context.data.event.target as HTMLElement;
      if (
        !target.closest(".rete-node") &&
        !target.closest(".socket") &&
        !target.closest(".rete-connection")
      ) {
        onSelect(null);
      }
    }
    return context;
  });
}
