// TODO: Add code to support bindgroups from nodes.
import { CubeNode } from "../node_gui/nodes/CubeNode";
import { GeometryData, getGeometries } from "../geometry/geometry";
import { Camera } from "../stage/camera";

export var canvas: HTMLCanvasElement;
export var canvasFormat: GPUTextureFormat;
export var context: GPUCanvasContext;
export var device: GPUDevice;
export var canvasTextureView: GPUTextureView;

export var aspectRatio: number;
export const fovYDegrees = 45;

export var modelBindGroupLayout: GPUBindGroupLayout;

export var nodeTest: CubeNode;

export async function initWebGPU() {
    canvas = document.getElementById("gpu-canvas") as HTMLCanvasElement;

    const devicePixelRatio = window.devicePixelRatio;
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = canvas.clientHeight * devicePixelRatio;

    aspectRatio = canvas.width / canvas.height;

    if (!navigator.gpu) {
        let errorMessageElement = document.createElement("h1");
        errorMessageElement.textContent =
            "This browser doesn't support WebGPU! Try using Google Chrome.";
        errorMessageElement.style.paddingLeft = "0.4em";
        document.body.innerHTML = "";
        document.body.appendChild(errorMessageElement);
        throw new Error("WebGPU not supported on this browser");
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
        throw new Error("no appropriate GPUAdapter found");
    }

    device = await adapter.requestDevice();

    context = canvas.getContext("webgpu")!;
    canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
        device: device,
        format: canvasFormat,
    });

    console.log("WebGPU init successsful");

    modelBindGroupLayout = device.createBindGroupLayout({
        label: "model bind group layout",
        entries: [
            {
                binding: 0,
                visibility: GPUShaderStage.VERTEX,
                buffer: { type: "uniform" },
            },
        ],
    });

    // nodeTest = new CubeNode();
    // await nodeTest.execute();
}

export const vertexBufferLayout: GPUVertexBufferLayout = {
    arrayStride: 32,
    attributes: [
        {
            // pos
            format: "float32x3",
            offset: 0,
            shaderLocation: 0,
        },
        {
            // indices
            format: "uint32",
            offset: 12,
            shaderLocation: 1,
        },
    ],
};

export class Renderer {
    protected camera: Camera;

    pipeline: GPURenderPipeline;
    modelBuffer: GPUBuffer;
    vertexBuffer: GPUBuffer;
    indexBuffer: GPUBuffer;
    indexCount: number;
    depthTexture: GPUTexture;
    depthView: GPUTextureView;
    bindGroupLayout: GPUBindGroupLayout;

    draw: () => void;

    constructor() {
        const shaderModule = device.createShaderModule({
            code: `
struct Camera {
  viewProj : mat4x4<f32>
};
struct Model {
  model : mat4x4<f32>
};

@binding(0) @group(0) var<uniform> camera : Camera;
@binding(1) @group(0) var<uniform> model : Model;

struct VertexOut {
  @builtin(position) position : vec4<f32>,
  @location(0) vColor : vec3<f32>
};

@vertex
fn vs_main(@location(0) position : vec3<f32>) -> VertexOut {
  var out : VertexOut;
  out.position = camera.viewProj * (model.model * vec4<f32>(position, 1.0));
  out.vColor = (position + vec3<f32>(1.0,1.0,1.0)) * 0.5;
  return out;
}

@fragment
fn fs_main(in : VertexOut) -> @location(0) vec4<f32> {
  return vec4<f32>(in.vColor, 1.0);
}
`,
        });

        this.bindGroupLayout = device.createBindGroupLayout({
            label: "renderer bind group layout",
            entries: [
                {
                    // camera
                    binding: 0,
                    visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                    buffer: { type: "uniform" },
                },
                {
                    // model
                    binding: 1,
                    visibility: GPUShaderStage.VERTEX,
                    buffer: { type: "uniform" },
                },
            ],
        });

        this.pipeline = device.createRenderPipeline({
            layout: device.createPipelineLayout({
                bindGroupLayouts: [this.bindGroupLayout],
            }),
            vertex: {
                module: shaderModule,
                entryPoint: "vs_main",
                buffers: [
                    {
                        arrayStride: 12,
                        attributes: [{ shaderLocation: 0, offset: 0, format: "float32x3" }],
                    },
                ],
            },
            fragment: {
                module: shaderModule,
                entryPoint: "fs_main",
                targets: [{ format: canvasFormat }],
            },
            primitive: { topology: "triangle-list", cullMode: "back" },
            depthStencil: {
                format: "depth24plus",
                depthWriteEnabled: true,
                depthCompare: "less",
            },
        });

        const geometries = getGeometries();

        console.log("Geometries available:", geometries.length);
        if (geometries.length === 0) {
            console.error(
                "No geometries available! Make sure nodeTest.execute() was called."
            );
        }

        const vertexData = new Float32Array(geometries[0].vertices);
        const indexData = new Uint32Array(geometries[0].indices);

        this.vertexBuffer = device.createBuffer({
            size: Math.max(vertexData.byteLength, 1024),
            usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
        });

        device.queue.writeBuffer(this.vertexBuffer, 0, geometries[0].vertices.buffer);

        this.indexBuffer = device.createBuffer({
            size: Math.max(indexData.byteLength, 1024),
            usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
        });
        device.queue.writeBuffer(this.indexBuffer, 0, geometries[0].indices.buffer);

        this.indexCount = indexData.length;

        this.depthTexture = device.createTexture({
            size: [canvas.width, canvas.height],
            format: "depth24plus",
            usage: GPUTextureUsage.RENDER_ATTACHMENT,
        });
        this.depthView = this.depthTexture.createView();

        console.log("Vertex buffer:", this.vertexBuffer);
        console.log("Index buffer:", this.indexBuffer);
        console.log("Index count:", this.indexCount);
        console.log("First few vertices:", Array.from(vertexData.slice(0, 9)));
        console.log("First few indices:", Array.from(indexData.slice(0, 12)));

        let modelMatUniformBuffer = device.createBuffer({
            label: "model mat uniform",
            size: 16 * 4,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });

        device.queue.writeBuffer(
            modelMatUniformBuffer,
            0,
            new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
        );

        let camera = new Camera();
        console.log("Camera uniform buffer:", camera.uniformsBuffer);
        console.log("Camera initialized");

        camera.onFrame(0);

        let rendererBindGroup = device.createBindGroup({
            label: "renderer bind group",
            layout: this.bindGroupLayout,
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: camera.uniformsBuffer,
                    },
                },
                {
                    binding: 1,
                    resource: { buffer: modelMatUniformBuffer },
                },
            ],
        });

        this.draw = function () {
            // Update camera matrices each frame
            camera.onFrame(16);

            const encoder = device.createCommandEncoder();

            const colorView = context.getCurrentTexture().createView();

            // Create renderpass
            const renderPass = encoder.beginRenderPass({
                label: "main pass",
                colorAttachments: [
                    {
                        view: colorView,
                        loadOp: "clear",
                        storeOp: "store",
                        clearValue: { r: 0.2, g: 0.2, b: 0.25, a: 1.0 },
                    },
                ],
                depthStencilAttachment: {
                    view: this.depthView!,
                    depthLoadOp: "clear",
                    depthStoreOp: "store",
                    depthClearValue: 1.0,
                },
            });

            const geometries = getGeometries();
            if (geometries.length > 0) {
                // Update buffers
                device.queue.writeBuffer(this.vertexBuffer, 0, geometries[0].vertices.buffer);
                device.queue.writeBuffer(this.indexBuffer, 0, geometries[0].indices.buffer);

                // CRITICAL FIX: Update index count to match current geometry
                this.indexCount = geometries[0].indices.length;
            } else {
                console.warn("No geometries available in draw loop!");
            }

            renderPass.setPipeline(this.pipeline);
            renderPass.setBindGroup(0, rendererBindGroup);
            renderPass.setVertexBuffer(0, this.vertexBuffer);
            renderPass.setIndexBuffer(this.indexBuffer, "uint32");

            console.log("Drawing with indexCount:", this.indexCount);

            renderPass.drawIndexed(this.indexCount, 1, 0, 0, 0);

            renderPass.end();

            device.queue.submit([encoder.finish()]);
        };
    }
}
