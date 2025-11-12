import React, { useState, useRef, useEffect } from "react";
import { initWebGPU, Renderer } from "./renderer/renderer";
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
        await initWebGPU();

        if (!mounted) return;

        const { destroy } = await createEditor(
          reteContainerRef.current!,
          setSelectedNode
        );

        if (!mounted) {
          destroy();
          return;
        }

        cleanupRef.current.editorDestroy = destroy;
        cleanupRef.current.renderer = new Renderer();

        const frame = () => {
          if (!mounted || !cleanupRef.current.renderer) return;

          cleanupRef.current.renderer.draw();
          cleanupRef.current.animationFrameId = requestAnimationFrame(frame);
        };
        frame();
      } catch (error) {
        console.error("Failed to initialize:", error);
      }
    };

    initialize();

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
      {/* Node Editor + Details Panel */}
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
        {/* Details Panel, fixed at top */}
        <div
          style={{
            flexShrink: 0,
            borderBottom: "1px solid #444",
          }}
        >
          <DetailsPanel node={selectedNode} />
        </div>

        {/* Rete Container */}
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

      {/* WebGPU Canvas */}
      <canvas
        id="gpu-canvas"
        ref={canvasRef}
        style={{
          flex: "0 0 40%",
          height: "100%",
          background: "#000",
          display: "block",
        }}
      />
    </div>
  );
}
