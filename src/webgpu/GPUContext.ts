export class GPUContext {
  public device!: GPUDevice;
  public context!: GPUCanvasContext;
  public format!: GPUTextureFormat;
  public canvas!: HTMLCanvasElement;

  private static instance: GPUContext;

  private onResizeCallbacks: ((aspect: number) => void)[] = [];

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

    this.notifyResizeSubscribers();
  }

  public get aspectRatio(): number {
    return this.canvas.width / this.canvas.height;
  }

  public resize(client_width: number, client_height: number): void {
    const devicePixelRatio = window.devicePixelRatio;

    // Update the canvas drawing buffer size (for WebGPU rendering)
    this.canvas.width = client_width * devicePixelRatio;
    this.canvas.height = client_height * devicePixelRatio;

    // Reconfigure the context (essential for WebGPU after a size change)
    this.context.configure({
      device: this.device,
      format: this.format,
    });

    // 3. Notify all subscribers (Camera)
    this.notifyResizeSubscribers();
  }

  public addResizeCallback(callback: (aspect: number) => void): void {
    this.onResizeCallbacks.push(callback);
    // Immediately call back on registration to initialize the camera's projection
    callback(this.aspectRatio);
  }

  private notifyResizeSubscribers(): void {
    const newAspect = this.aspectRatio;
    this.onResizeCallbacks.forEach((cb) => cb(newAspect));
  }
}
