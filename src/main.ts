// TODO: initialise WebGPU.
import "./style.css";
import { initWebGPU } from "./renderer/renderer";
import { createEditor } from "./node_gui/rete_editor";

(async () => {
  const reteContainer = document.getElementById("rete-container")!;

  await initWebGPU();
  await createEditor(reteContainer);
})();
