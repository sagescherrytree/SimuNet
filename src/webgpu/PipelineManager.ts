import { GPUContext } from "./GPUContext";
import lambertShader from "./shaders/lambertShader.wgsl";
import positionShader from "./shaders/positionShader.wgsl";

export type RenderMode = {
  shader: 0 | 1; // 0 for positionShader, 1 for lambertShader
  wireframe: boolean; // true for line-list, false for triangle-list
};

export class PipelineManager {
  private gpu: GPUContext;
  private pipelineCache: Map<string, GPURenderPipeline> = new Map();
  private sharedPipelineLayout: GPUPipelineLayout;
  private readonly vertexBufferLayout: GPUVertexBufferLayout;

  constructor() {
    this.gpu = GPUContext.getInstance();

    this.vertexBufferLayout = {
      arrayStride: 32,
      attributes: [
        { shaderLocation: 0, offset: 0, format: "float32x4" },
        { shaderLocation: 1, offset: 16, format: "float32x4" },
      ],
    };

    this.sharedPipelineLayout = this.createPipelineLayout();
  }

  private createPipelineLayout(): GPUPipelineLayout {
    const bindGroupLayout = this.gpu.device.createBindGroupLayout({
      label: "shared-bind-group-layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.VERTEX,
          buffer: { type: "uniform" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });
    const materialBindGroupLayout = this.gpu.device.createBindGroupLayout({
      label: "material-bind-group-layout",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
      ],
    });

    return this.gpu.device.createPipelineLayout({
      label: "shared-pipeline-layout",
      bindGroupLayouts: [bindGroupLayout, materialBindGroupLayout],
    });
  }

  public getPipeline(mode: RenderMode): GPURenderPipeline {
    const key = `${mode.shader}-${mode.wireframe}`;

    if (this.pipelineCache.has(key)) {
      return this.pipelineCache.get(key)!;
    }

    const pipeline = this.createPipeline(mode);
    this.pipelineCache.set(key, pipeline);
    return pipeline;
  }

  private createPipeline(mode: RenderMode): GPURenderPipeline {
    const shaderCode = mode.shader === 0 ? positionShader : lambertShader;
    const shaderModule = this.gpu.device.createShaderModule({
      label: `${mode.shader === 0 ? "position" : "lambert"}-${mode.wireframe ? "wireframe" : "lit"
        }-shader-module`,
      code: shaderCode,
    });

    const pipelineDescriptor: GPURenderPipelineDescriptor = {
      label: `${mode.shader === 0 ? "Position" : "Lambert"} ${mode.wireframe ? "Wireframe" : "Lit"
        } Pipeline`,
      layout: this.sharedPipelineLayout,
      vertex: {
        module: shaderModule,
        entryPoint: "vs_main",
        buffers: [this.vertexBufferLayout],
      },
      fragment: {
        module: shaderModule,
        entryPoint: "fs_main",
        targets: [{ format: this.gpu.format }],
      },
      primitive: {
        topology: mode.wireframe ? "line-list" : "triangle-list",
        cullMode: "none",
      },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: true,
        depthCompare: "less",
      },
    };

    return this.gpu.device.createRenderPipeline(pipelineDescriptor);
  }

  public getBindGroupLayout(index: number): GPUBindGroupLayout {
    throw new Error(
      "Renderer should get the layout from the pipeline returned by getPipeline(..)"
    );
  }
}
