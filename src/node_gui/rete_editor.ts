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
import { Schemes, AreaExtra, NodeTypes } from "./types";
import { GraphEngine } from "./engine/GraphEngine";
import { Node } from "./types";
import { Connection } from "./connections/Connection";


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

  const engine = new GraphEngine(editor);

  const contextMenu = new ContextMenuPlugin<Schemes>({
    items: ContextMenuPresets.classic.setup(getContextMenuItems()),
  });

  area.use(contextMenu);

  setupSelection(area, editor, onNodeSelected);

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

  return { editor, destroy: () => area.destroy() };
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
      if (target.closest(".rete-container") && !target.closest(".rete-node")) {
        onSelect(null);
      }
    }
    return context;
  });
}
