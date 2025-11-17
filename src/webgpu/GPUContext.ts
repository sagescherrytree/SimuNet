export class GPUContext {
  public device!: GPUDevice;
  public context!: GPUCanvasContext;
  public format!: GPUTextureFormat;
  public canvas!: HTMLCanvasElement;

  private static instance: GPUContext;

  private constructor() {}

  public static getInstance(): GPUContext {
    if (!this.instance) {
      this.instance = new GPUContext();
    }
    return this.instance;
  }

  public async init(canvasId: string): Promise<void> {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;

    if (!navigator.gpu) {
      throw new Error("WebGPU not supported on this browser");
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No appropriate GPUAdapter found");

    this.device = await adapter.requestDevice();
    this.context = this.canvas.getContext("webgpu")!;
    this.format = navigator.gpu.getPreferredCanvasFormat();

    const devicePixelRatio = window.devicePixelRatio;
    this.canvas.width = this.canvas.clientWidth * devicePixelRatio;
    this.canvas.height = this.canvas.clientHeight * devicePixelRatio;

    this.context.configure({
      device: this.device,
      format: this.format,
    });

    console.log("WebGPU Initialized");
  }

  public get aspectRatio(): number {
    return this.canvas.width / this.canvas.height;
  }
}
