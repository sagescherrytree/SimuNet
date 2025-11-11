// TODO: initialise WebGPU.
import "./style.css";
import { initWebGPU } from "./renderer/renderer";
import { createEditor } from "./rete/rete_editor";

(async () => {
  const reteContainer = document.getElementById("rete-container")!;

  await initWebGPU();
  await createEditor(reteContainer);
})();
