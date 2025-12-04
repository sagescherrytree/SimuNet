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
  NodeTypes,
  AreaExtra,
} from "../types";
import { Schemes } from "../types";
import { IGeometryModifier } from "../interfaces/NodeCapabilities";
import { Connection } from "../connections/Connection";
import { AreaPlugin } from "rete-area-plugin";

export class GraphEngine {
  constructor(private editor: NodeEditor<Schemes>, private area: AreaPlugin<Schemes, AreaExtra>) { }

  // TODO: Update logic to handle multiple node inputs.

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

      if (isCombiner(target)) {
        const index = this.getInputIndex(conn.targetInput);
        target.setInputGeometry(geometry, index);
        console.log(`Flow: ${source.label} -> ${target.label} Input #${index}`);
        // target.setInputGeometry(index, geometry);
        
        // if (isExecutable(target)) {
        //   console.log("executing:");
        //   console.log(target);
        //   await target.execute();
        // }
        // } else {
      } else if (isModifier(target)) {
        target.setInputGeometry(geometry);
        console.log(`Flow: ${source.label} -> ${target.label}`);
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


  async saveFile() {

  }

  async loadFile() {
    // window.showOpenFilePicker();
  }
  exportGraphToJSON() {
    // planning
    //  maybe can export only the trees from base geometries if wanting to ensure can just represent as simple JSON?
    // also makes import order easy to deal with since root onwards makes sure can just gen each when it's loaded I guess
    // or maybe should make connection adding check whether it'll create a loop always and just prevent it if so? no renderable/usable graphs have it
    // ACTUALLY not an issue with how this is set up now I think
    // TODO

    // connections need:
    /* e.g.:
    id: "18af055ebd5dae67"
    source: "cf2adb1585532f2b"
    sourceOutput: "geometry"
    target: "005571788a916df3"
    targetInput: "geometry"
    */
    // nodes need:
    /*
    id: string
    inputs
    outputs: { id: string, label:string, multipleConnections:boolean}
    ...
    //controls
    // need values hmm
    maybe use label for getting node type, construct node as normal when added, then set values for each control?
    // then I guess need:
      id: string
      label: string
      each control values
        unfortunately .controls doesn't reference those controls so somewhat need a way to figure out which ones those are. Could just look through all children which have a .label and .value child maybe
        ahh nevermind can use getEditableControls
    */

    // can't just run JSON.stringify on nodes since they have a circular reference to themselves (plus need to handle the functions anyway)

    let allNodes = this.editor.getNodes();
    let allConnections = this.editor.getConnections();

    let nodeViews = this.area.nodeViews;

    const nodeData = [];
    for (const node of allNodes) {
      const outData = {
        id: node.id,
        label: node.label,
        controls: node.getEditableControls()
      };
      nodeData.push(outData);
    }

    console.log(nodeViews);
    const nodePositionData = [];
    for (const [key, value] of nodeViews) {
      const pos = value.position;
      nodePositionData.push({
        id: key,
        position: pos
      });
    }

    const outputObject = {
      nodes: nodeData,
      connections: allConnections,
      nodePositions: nodePositionData
    };


    const jsonOutput = JSON.stringify(outputObject);
    return jsonOutput;
  }

  async loadGraphFromJSON(jsonInput: string) {

    let inputObject: any;
    try {
      inputObject = JSON.parse(jsonInput);
    } catch (e) {
      if (e instanceof SyntaxError) {
        console.log("Invalid JSON input: syntax error");
      } else {
        console.log(e.message, e.name, e.stack);
      }
      return;
    }

    if (!("nodes" in inputObject)) {
      console.log("Invalid JSON input: missing nodes");
      return;
    }
    if (!("connections" in inputObject)) {
      console.log("Invalid JSON input: missing connections");
      return;
    }
    await this.editor.clear();

    for (const nodeData of inputObject.nodes) {
      let node: Node;
      if (nodeData.label == "ClothNode") {
        node = NodeTypes.Cloth();
      } else if (nodeData.label == "CopyToPoints") {
        node = NodeTypes.CopyToPoints();
      } else if (nodeData.label == "CubeNode") {
        node = NodeTypes.Cube();
      } else if (nodeData.label == "IcosphereNode") {
        node = NodeTypes.Icosphere();
      } else if (nodeData.label == "NoiseNode") {
        node = NodeTypes.Noise();
      } else if (nodeData.label == "PlaneNode") {
        node = NodeTypes.Plane();
      } else if (nodeData.label == "TorusNode") {
        node = NodeTypes.Torus();
      } else if (nodeData.label == "TransformNode") {
        node = NodeTypes.Transform();
      } else if (nodeData.label == "RecomputeNormals") {
        node = NodeTypes.RecomputeNormals();
      } else if (nodeData.label == "Material") {
        node = NodeTypes.Material();
      }
      // TODO probably go remove ...Node from all the labels; redundant for user to see

      node.id = nodeData.id;
      const nodeControls = node.getEditableControls();
      for (const key in nodeData.controls) {
        console.log(nodeControls[key]);
        console.log(nodeData.controls[key]);
        nodeControls[key].value = nodeData.controls[key].value;
      }
      // TODO I think redundant with updateAllGeometries later?
      // if (isExecutable(node)) {
      //   node.execute();
      // }
      await this.editor.addNode(node);
    }

    if ("connections" in inputObject) {
      for (const connectionData of inputObject.connections) {
        await this.editor.addConnection(connectionData);
      }
    }

    if ("nodePositions" in inputObject) {
      for (const posData of inputObject.nodePositions) {
        // shouldn't need an await I think since nothing relies on this being done
        this.area.translate(posData.id, posData.position);
      }
    }

    this.updateAllGeometries(null);
  }

  // TODO: relatedly remove CPU-side vertex/index data that's not needed anymore, causes slowdown
  // TODO also there's some slowdown on clicking on a different node type it seems? removing the CPU-side vertices/indices arrays seems to speed it up some but still like 100ms delay?
  //  assume some sort of updating work is happening when doing that even though not necessary
  // ALSO TODO I want to try adding perhaps a 'recompute normals' node that runs through all the triangles and sets normals to that of the face (though to make hard edges might not work for all base geometries unless add extra indices?)
}
