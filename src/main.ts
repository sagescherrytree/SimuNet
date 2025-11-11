// TODO: initialise WebGPU.
import "./style.css";
import { initWebGPU, Renderer } from "./renderer/renderer";
import { createEditor } from "./node_gui/rete_editor";

(async () => {
  const reteContainer = document.getElementById("rete-container")!;

  await initWebGPU();
  await createEditor(reteContainer);

  const renderer = new Renderer();

  // simple animation loop
  function frame() {
    renderer.draw();
    requestAnimationFrame(frame);
  }
  frame();
})();
