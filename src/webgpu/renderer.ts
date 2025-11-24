import { Camera } from "./stage/camera";
import { GPUContext } from "./GPUContext";
import { SceneManager } from "./SceneManager";
import { PipelineManager } from "./PipelineManager";
import { GeometryData } from "../node_gui/geometry/geometry";
import { vec3 } from "wgpu-matrix";

export class Renderer {
  private gpu: GPUContext;
  private scene: SceneManager;
  private camera: Camera;

  private pipelineManager: PipelineManager;

  private bindGroup: GPUBindGroup;
  private depthTexture!: GPUTexture;
  private depthView!: GPUTextureView;

  public selectedNodeId: string | null = null;
  public selectedGeometry: GeometryData | null = null;

  private lightBuffer: GPUBuffer;
  private lightData: Float32Array;

  public onNodeSelected?: (nodeId: string, geometry: GeometryData) => void;
  public onNodeDeselected?: () => void;

  private shaderMode: 0 | 1 = 1;
  private wireframeMode = false;

  constructor(sceneManager: SceneManager) {
    this.gpu = GPUContext.getInstance();
    this.scene = sceneManager;
    this.camera = new Camera();
    this.pipelineManager = new PipelineManager();

    this.setupObjectSelection();

    this.camera.onFocusRequested = () => {
      if (this.selectedGeometry?.boundingSphere) {
        const center = this.selectedGeometry.boundingSphere.center;
        const radius = this.selectedGeometry.boundingSphere.radius;

        const distance = radius * 5;

        const focusPoint = vec3.create(center[0], center[1], center[2]);

        this.camera.focusOnPoint(focusPoint, distance);
      } else {
        console.log("No object selected to focus on.");
      }
    };

    const lightData = new Float32Array([
      5.0,
      5.0,
      5.0, // Position (vec3)
      0.8, // Ambient (f32)
      1.0,
      1.0,
      1.0, // Color (vec3)
      0.0, // Padding (f32) - Total 8 floats
    ]);

    this.lightData = lightData;

    this.lightBuffer = this.gpu.device.createBuffer({
      size: this.lightData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.bindGroup = this.createBindGroup();

    this.gpu.addResizeCallback(() => this.createDepthTexture());
    this.createDepthTexture();
  }

  private setupObjectSelection() {
    this.camera.onObjectClick = (ray) => {
      const hit = this.scene.findClickedGeometry(ray);

      if (hit) {
        this.selectedNodeId = hit.nodeId;
        this.selectedGeometry = hit.geometry;
        console.log(
          `Selected node: ${hit.nodeId} at distance ${hit.distance.toFixed(2)}`
        );

        if (this.onNodeSelected) {
          this.onNodeSelected(hit.nodeId, hit.geometry);
        }
      } else {
        this.selectedNodeId = null;
        this.selectedGeometry = null;
        console.log("Clicked empty space");

        if (this.onNodeDeselected) {
          this.onNodeDeselected();
        }
      }
    };
  }

  private createBindGroup(): GPUBindGroup {
    const modelBuffer = this.gpu.device.createBuffer({
      size: 64,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.gpu.device.queue.writeBuffer(
      modelBuffer,
      0,
      new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
    );

    const initialPipeline = this.pipelineManager.getPipeline({
      shader: this.shaderMode,
      wireframe: this.wireframeMode,
    });

    return this.gpu.device.createBindGroup({
      label: "main-bind-group",
      layout: initialPipeline.getBindGroupLayout(0),
      entries: [
        { binding: 0, resource: { buffer: this.camera.uniformsBuffer } },
        { binding: 1, resource: { buffer: modelBuffer } },
        { binding: 2, resource: { buffer: this.lightBuffer } },
      ],
    });
  }

  public toggleShader() {
    this.shaderMode = this.shaderMode === 0 ? 1 : 0;
  }

  public toggleWireframe() {
    this.wireframeMode = !this.wireframeMode;
  }

  private createDepthTexture() {
    this.depthTexture = this.gpu.device.createTexture({
      size: [this.gpu.canvas.width, this.gpu.canvas.height],
      format: "depth24plus",
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.depthView = this.depthTexture.createView();
  }

  public startLoop() {
    const frame = () => {
      this.draw();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  private draw() {
    this.camera.onFrame(16);

    if (this.shaderMode != 0) {
      this.gpu.device.queue.writeBuffer(
        this.lightBuffer,
        0,
        this.lightData.buffer
      );
    }

    // if (this.scene.getGeometries().length === 0) {
    // // if (!this.scene.vertexBuffer || !this.scene.indexBuffer) {
    //   return;
    // }

    const currentPipeline = this.pipelineManager.getPipeline({
      shader: this.shaderMode,
      wireframe: this.wireframeMode,
    });

    const commandEncoder = this.gpu.device.createCommandEncoder();
    const passEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.gpu.context.getCurrentTexture().createView(),
          clearValue: { r: 0.2, g: 0.2, b: 0.25, a: 1.0 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: this.depthView,
        depthClearValue: 1.0,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });

    passEncoder.setPipeline(currentPipeline);
    passEncoder.setBindGroup(0, this.bindGroup);

    for (const geom of this.scene.getGeometries()) {
      passEncoder.setVertexBuffer(0, geom.vertexBuffer);
      if (this.wireframeMode && geom.wireframeIndexBuffer) {
        passEncoder.setIndexBuffer(geom.wireframeIndexBuffer, "uint32");
        if (geom.wireframeIndexBuffer.size !== 0) {
          passEncoder.drawIndexed(geom.wireframeIndexBuffer.size / 4);
        }
      } else {
        passEncoder.setIndexBuffer(geom.indexBuffer, "uint32");
        if (geom.indexBuffer.size !== 0) {
          passEncoder.drawIndexed(geom.indexBuffer.size / 4);
        }
      }
    }

    // TODO change back to single draw per material?
    // passEncoder.setVertexBuffer(0, this.scene.vertexBuffer);
    // if (this.wireframeMode && this.scene.wireframeIndexBuffer) {
    //   passEncoder.setIndexBuffer(this.scene.wireframeIndexBuffer, "uint32");
    //   if (this.scene.wireframeIndexCount !== 0) {
    //     passEncoder.drawIndexed(this.scene.wireframeIndexCount);
    //   }
    // } else {
    //   passEncoder.setIndexBuffer(this.scene.indexBuffer, "uint32");
    //   if (this.scene.indexCount !== 0) {
    //     passEncoder.drawIndexed(this.scene.indexCount);
    //   }
    // }
    passEncoder.end();

    this.gpu.device.queue.submit([commandEncoder.finish()]);
  }
}
