import React, { useState, useRef, useEffect } from "react";
import { GPUContext } from "./webgpu/GPUContext";
import { SceneManager } from "./webgpu/SceneManager";
import { Renderer } from "./webgpu/renderer";
import { createEditor } from "./node_gui/rete_editor";
import { DetailsPanel } from "./node_gui/components/DetailsPanel";
import { Node } from "./node_gui/types";
import "./style.css";

export function App() {
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  const reteContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const cleanupRef = useRef<{
    animationFrameId: number | null;
    editorDestroy: (() => void) | null;
    renderer: Renderer | null;
  }>({
    animationFrameId: null,
    editorDestroy: null,
    renderer: null,
  });

  useEffect(() => {
    if (!reteContainerRef.current || !canvasRef.current) {
      return;
    }

    let mounted = true;

    const initialize = async () => {
      try {
        // 1. Initialize WebGPU Layer
        const gpu = GPUContext.getInstance();

        // Ensure the canvas has the ID expected by GPUContext
        // (Or refactor GPUContext to accept an HTMLCanvasElement directly)
        await gpu.init("gpu-canvas");

        if (!mounted) return;

        // 2. Initialize Scene & Renderer
        // The SceneManager automatically listens to geometry events
        const sceneManager = new SceneManager();

        // The Renderer needs the scene to know what buffers to draw
        const renderer = new Renderer(sceneManager);

        cleanupRef.current.renderer = renderer;

        // 3. Initialize Node Editor
        const { editor, destroy } = await createEditor(
          reteContainerRef.current!,
          setSelectedNode
        );

        if (!mounted) {
          destroy();
          return;
        }

        cleanupRef.current.editorDestroy = destroy;

        // 4. Start Render Loop
        // We run the loop here in React so we can cancel it easily
        const frame = () => {
          if (!mounted) return;

          // The renderer's draw method handles the camera update
          // and the actual WebGPU render pass
          if (cleanupRef.current.renderer) {
            // Note: If your Renderer class has a private draw,
            // change it to public or add a public render() method.
            (cleanupRef.current.renderer as any).draw();
          }

          cleanupRef.current.animationFrameId = requestAnimationFrame(frame);
        };

        frame();
      } catch (error) {
        console.error("Failed to initialize:", error);
      }
    };

    initialize();

    // Cleanup on Unmount
    return () => {
      mounted = false;

      if (cleanupRef.current.animationFrameId) {
        cancelAnimationFrame(cleanupRef.current.animationFrameId);
        cleanupRef.current.animationFrameId = null;
      }

      if (cleanupRef.current.editorDestroy) {
        cleanupRef.current.editorDestroy();
        cleanupRef.current.editorDestroy = null;
      }

      cleanupRef.current.renderer = null;
      // Note: We generally don't destroy the GPU device
      // as it's expensive to recreate.
    };
  }, []);

  return (
    <div
      style={{
        display: "flex",
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
      }}
    >
      {/* Left: Node Editor + Details Panel */}
      <div
        style={{
          flex: "0 0 60%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          position: "relative",
          minWidth: 0,
        }}
      >
        <div
          style={{
            flexShrink: 0,
            borderBottom: "1px solid #444",
            background: "#222",
            zIndex: 10,
          }}
        >
          <DetailsPanel node={selectedNode} />
        </div>

        <div
          id="rete-container"
          ref={reteContainerRef}
          style={{
            flex: 1,
            position: "relative",
            overflow: "hidden",
          }}
        />
      </div>

      {/* Right: WebGPU Canvas */}
      <canvas
        id="gpu-canvas" // Matches the string passed to gpu.init()
        ref={canvasRef}
        style={{
          flex: "0 0 40%",
          height: "100%",
          background: "#111",
          display: "block",
        }}
      />
    </div>
  );
}
