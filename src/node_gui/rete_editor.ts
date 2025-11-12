// src/components/index.ts
import { createRoot } from "react-dom/client";
import { NodeEditor } from "rete";
import { AreaPlugin, AreaExtensions } from "rete-area-plugin";
import {
  ConnectionPlugin,
  Presets as ConnectionPresets,
} from "rete-connection-plugin";
import { ReactPlugin, Presets, ReactArea2D } from "rete-react-plugin";
import {
  AutoArrangePlugin,
  Presets as ArrangePresets,
} from "rete-auto-arrange-plugin";
import {
  ContextMenuPlugin,
  Presets as ContextMenuPresets,
} from "rete-context-menu-plugin";

import { Schemes, AreaExtra, NodeTypes, CubeNode, NodeB } from "./types";
import { Connection } from "./connections/Connection";
// import { getDOMSocketPosition } from "rete-render-utils";

function getContextMenuItems() {
  const items = [...Object.entries(NodeTypes)];

  return items;
}

export async function createEditor(container: HTMLElement) {
  const editor = new NodeEditor<Schemes>();
  const area = new AreaPlugin<Schemes, AreaExtra>(container);
  const connection = new ConnectionPlugin<Schemes, AreaExtra>();
  const render = new ReactPlugin<Schemes, AreaExtra>({ createRoot });
  const arrange = new AutoArrangePlugin<Schemes>();

  const contextMenu = new ContextMenuPlugin<Schemes>({
    items: ContextMenuPresets.classic.setup(getContextMenuItems()),
  });

  area.use(contextMenu);

  AreaExtensions.selectableNodes(area, AreaExtensions.selector(), {
    accumulating: AreaExtensions.accumulateOnCtrl(),
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

  editor.addPipe((context) => {
    if (context.type === "nodecreate") {
      let createdNode = context.data;
      if (createdNode instanceof CubeNode) {
        (createdNode as CubeNode).execute();
      }
    }
    return context;
  });

  await arrange.layout();
  AreaExtensions.zoomAt(area, editor.getNodes());

  return {
    destroy: () => area.destroy(),
  };
}
