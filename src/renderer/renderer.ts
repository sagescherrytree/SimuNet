// TODO: Add code to support bindgroups from nodes.

export var canvas: HTMLCanvasElement;
export var canvasFormat: GPUTextureFormat;
export var context: GPUCanvasContext;
export var device: GPUDevice;
export var canvasTextureView: GPUTextureView;

export var aspectRatio: number;
export const fovYDegrees = 45;

export async function initWebGPU() {
    canvas = document.getElementById("gpu-canvas") as HTMLCanvasElement;

    const devicePixelRatio = window.devicePixelRatio;
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = canvas.clientHeight * devicePixelRatio;

    aspectRatio = canvas.width / canvas.height;

    if (!navigator.gpu) {
        let errorMessageElement = document.createElement("h1");
        errorMessageElement.textContent = "This browser doesn't support WebGPU! Try using Google Chrome.";
        errorMessageElement.style.paddingLeft = '0.4em';
        document.body.innerHTML = '';
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
}