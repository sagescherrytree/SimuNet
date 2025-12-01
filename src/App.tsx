import { useState, useRef, useEffect } from "react";
import { GPUContext } from "./webgpu/GPUContext";
import { SceneManager } from "./webgpu/SceneManager";
import { Renderer } from "./webgpu/renderer";
import { createEditor } from "./node_gui/rete_editor";
import { DetailsPanel } from "./node_gui/components/DetailsPanel";
import { Node } from "./node_gui/types";
import "./style.css";
import { GraphEngine } from "./node_gui/engine/GraphEngine";

export function App() {
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);

  const reteContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const cleanupRef = useRef<{
    animationFrameId: number | null;
    editorDestroy: (() => void) | null;
    renderer: Renderer | null;
    engine: GraphEngine | null;
  }>({
    animationFrameId: null,
    editorDestroy: null,
    renderer: null,
    engine: null,
  });

  useEffect(() => {
    const renderer = cleanupRef.current.renderer;

    if (renderer) {
      if (selectedNode && selectedNode.geometry) {
        renderer.selectedNodeId = selectedNode.id;
        renderer.selectedGeometry = selectedNode.geometry;
      } else {
        renderer.selectedNodeId = null;
        renderer.selectedGeometry = null;
      }
    }
  }, [selectedNode]);

  useEffect(() => {
    if (!reteContainerRef.current || !canvasRef.current) {
      return;
    }

    let mounted = true;

    const gpu = GPUContext.getInstance();

    const resizeHandler = () => {
      // Calculate the new client dimensions based on the CSS layout (40% width, 100% height)
      const canvasContainerWidth = window.innerWidth * 0.4;
      const canvasContainerHeight = window.innerHeight;

      // Call the GPUContext's resize method with the new CLIENT dimensions
      gpu.resize(canvasContainerWidth, canvasContainerHeight);
    };

    const initialize = async () => {
      try {
        // 1. Initialize WebGPU Layer
        const gpu = GPUContext.getInstance();

        // Ensure the canvas has the ID expected by GPUContext
        // (Or refactor GPUContext to accept an HTMLCanvasElement directly)
        await gpu.init("gpu-canvas");

        window.addEventListener("resize", resizeHandler);

        resizeHandler();

        if (!mounted) return;

        // 2. Initialize Scene & Renderer
        // The SceneManager automatically listens to geometry events
        const sceneManager = new SceneManager();

        // The Renderer needs the scene to know what buffers to draw
        const renderer = new Renderer(sceneManager);

        cleanupRef.current.renderer = renderer;

        // 3. Initialize Node Editor
        const { editor, destroy, getNodeById, engine } = await createEditor(
          reteContainerRef.current!,
          setSelectedNode,
          renderer
        );

        cleanupRef.current.engine = engine;

        renderer.onNodeSelected = (nodeId, geometry) => {
          console.log("Selected node from 3D view:", nodeId);
          console.log("Geometry:", geometry);

          const node = getNodeById(nodeId);

          if (node) {
            setSelectedNode(node);
          } else {
            console.error(`Node with ID ${nodeId} not found in editor.`);
            setSelectedNode(null);
          }
        };

        renderer.onNodeDeselected = () => {
          console.log("Deselected - clicked empty space");
          setSelectedNode(null);
        };

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

      window.removeEventListener("resize", resizeHandler);

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

        {/* TODO where to put */}
        {/* Graph Settings / Save/Load Toolbar */}
        <div
          style={{
            position: "absolute",
            top: "10px",
            right: "10px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            padding: "8px",
            backgroundColor: "rgba(34, 34, 34, 0.95)",
            borderRadius: "6px",
            zIndex: 100,
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.3)",
          }}
        >
          {/* Save Button */}
          <a id="fileSave" style={{ display: "none", }}></a>
          <button
            onClick={async () => {
              if (cleanupRef.current.engine) {
                const text = cleanupRef.current.engine.exportGraphToJSON();

                if ("showSaveFilePicker" in window && window.showSaveFilePicker instanceof Function) {
                  const handle = await window.showSaveFilePicker({
                    suggestedName: "SimuNet_SavedGraph.json",
                    types: [{ description: "JSON Files", accept: { "application/json": [".json"] } }]
                  })
                  const writable = await handle.createWritable();
                  await writable.write(text);
                  await writable.close();
                } else {
                  // Fallback case if file picker doesn't work
                  const link = document.getElementById('fileSave');
                  link.setAttribute('href', 'data:text/plain;charset=utf-8,' + encodeURIComponent(text));
                  link.setAttribute('download', 'SimuNet_SavedGraph.json');
                  link.click();
                }
              }
            }}
            title="Export Graph"
            style={{
              padding: "6px",
              backgroundColor: "#444",
              color: "#fff",
              border: "1px solid #666",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "16px",
              width: "32px",
              height: "32px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = "#555")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = "#444")
            }
          >
            💾
          </button>

          {/* Load Button */}
          <input type="file" id="fileInput" accept=".json"
            style={{ display: "none", }}
            onChange={function () {
              let fileInput = document.getElementById("fileInput") as HTMLInputElement;
              if (cleanupRef.current.engine && fileInput.files.length > 0) {
                let file = fileInput.files[0];
                const reader = new FileReader();
                reader.onload = (event) => {
                  cleanupRef.current.engine.loadGraphFromJSON(event.target.result.toString());
                };
                reader.readAsText(file);
              }
            }}
          />
          <button
            onClick={() => {
              document.getElementById("fileInput").click();
            }}
            title="Import Graph"
            style={{
              padding: "6px",
              backgroundColor: "#444",
              color: "#fff",
              border: "1px solid #666",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "16px",
              width: "32px",
              height: "32px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = "#555")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = "#444")
            }
          >
            📂
          </button>
        </div>

      </div>

      {/* Right: WebGPU Canvas */}
      <div style={{ flex: "0 0 40%", height: "100%", position: "relative" }}>
        {/* Canvas Toolbar */}
        <div
          style={{
            position: "absolute",
            top: "10px",
            right: "10px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            padding: "8px",
            backgroundColor: "rgba(34, 34, 34, 0.95)",
            borderRadius: "6px",
            zIndex: 100,
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.3)",
          }}
        >
          <button
            onClick={() => {
              if (cleanupRef.current.renderer) {
                cleanupRef.current.renderer.toggleShader();
              }
            }}
            title="Toggle Lighting Shader"
            style={{
              padding: "6px",
              backgroundColor: "#444",
              color: "#fff",
              border: "1px solid #666",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "16px",
              width: "32px",
              height: "32px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = "#555")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = "#444")
            }
          >
            💡
          </button>

          {/* Wireframe Button */}
          <button
            onClick={() => {
              if (cleanupRef.current.renderer) {
                cleanupRef.current.renderer.toggleWireframe();
              }
            }}
            title="Toggle Wireframe"
            style={{
              padding: "6px",
              backgroundColor: "#444",
              color: "#fff",
              border: "1px solid #666",
              borderRadius: "4px",
              cursor: "pointer",
              fontSize: "16px",
              width: "32px",
              height: "32px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            onMouseEnter={(e) =>
              (e.currentTarget.style.backgroundColor = "#555")
            }
            onMouseLeave={(e) =>
              (e.currentTarget.style.backgroundColor = "#444")
            }
          >
            🌐
          </button>
        </div>

        <canvas
          id="gpu-canvas"
          ref={canvasRef}
          style={{
            width: "100%",
            height: "100%",
            background: "#111",
            display: "block",
          }}
        />

        {selectedNode && (
          <div
            style={{
              position: "absolute",
              top: "10px",
              left: "10px",
              padding: "10px 20px",
              backgroundColor: "rgba(0, 255, 0, 0.9)",
              color: "black",
              fontFamily: "monospace",
              fontSize: "14px",
              borderRadius: "5px",
              zIndex: 10000,
              pointerEvents: "none",
            }}
          >
            Selected: {selectedNode.id}
          </div>
        )}
      </div>
    </div>
  );
}
