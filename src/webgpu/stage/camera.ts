// src/stage/camera.ts
import { Mat4, mat4, Vec3, vec3 } from "wgpu-matrix";
import { toRadians } from "../../math_util";
import { GPUContext } from "../GPUContext";

class CameraUniforms {
  readonly buffer = new ArrayBuffer(52 * 4);
  private readonly floatView = new Float32Array(this.buffer);

  set viewProjMat(mat: Float32Array) {
    this.floatView.set(mat.subarray(0, 16));
  }

  set viewMat(mat: Float32Array) {
    this.floatView.set(mat.subarray(0, 16), 16);
  }

  set inverseProj(mat: Float32Array) {
    this.floatView.set(mat.subarray(0, 16), 32);
  }

  screenSize(width: number, height: number) {
    this.floatView[48] = width;
    this.floatView[49] = height;
  }

  set near(value: number) {
    this.floatView[50] = value;
  }

  set far(value: number) {
    this.floatView[51] = value;
  }
}

export class Camera {
  uniforms: CameraUniforms = new CameraUniforms();
  uniformsBuffer: GPUBuffer;

  projMat: Mat4 = mat4.create();
  invProjMat: Mat4 = mat4.create();
  cameraPos: Vec3 = vec3.create(-7, 2, 0);
  cameraFront: Vec3 = vec3.create(0, 0, -1);
  cameraUp: Vec3 = vec3.create(0, 1, 0);
  cameraRight: Vec3 = vec3.create(1, 0, 0);
  yaw: number = 0;
  pitch: number = 0;
  moveSpeed: number = 0.004;
  sensitivity: number = 0.15;

  static readonly nearPlane = 0.1;
  static readonly farPlane = 1000;
  static readonly fovYDegrees = 45; // Moved here as a static constant

  keys: { [key: string]: boolean } = {};

  private gpu: GPUContext; // <--- Reference to GPU Context

  constructor() {
    // 1. Get the Singleton Instance
    this.gpu = GPUContext.getInstance();

    // 2. Create Buffer using the instance's device
    this.uniformsBuffer = this.gpu.device.createBuffer({
      size: this.uniforms.buffer.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // 3. Calculate Projection Matrix using instance's aspect ratio
    this.projMat = mat4.perspective(
      toRadians(Camera.fovYDegrees),
      this.gpu.aspectRatio,
      Camera.nearPlane,
      Camera.farPlane
    );

    this.invProjMat = mat4.inverse(this.projMat);

    this.rotateCamera(0, 0);

    // 4. Event Listeners
    window.addEventListener("keydown", (event) => this.onKeyEvent(event, true));
    window.addEventListener("keyup", (event) => this.onKeyEvent(event, false));
    window.onblur = () => (this.keys = {});

    // 5. Canvas Event Listeners (Use this.gpu.canvas)
    this.gpu.canvas.addEventListener("mousedown", () =>
      this.gpu.canvas.requestPointerLock()
    );
    this.gpu.canvas.addEventListener("mouseup", () =>
      document.exitPointerLock()
    );
    this.gpu.canvas.addEventListener("mousemove", (event) =>
      this.onMouseMove(event)
    );
  }

  private onKeyEvent(event: KeyboardEvent, down: boolean) {
    this.keys[event.key.toLowerCase()] = down;
    if (this.keys["alt"]) {
      event.preventDefault();
    }
  }

  private rotateCamera(dx: number, dy: number) {
    this.yaw += dx;
    this.pitch -= dy;

    if (this.pitch > 89) {
      this.pitch = 89;
    }
    if (this.pitch < -89) {
      this.pitch = -89;
    }

    const front = mat4.create();
    front[0] = Math.cos(toRadians(this.yaw)) * Math.cos(toRadians(this.pitch));
    front[1] = Math.sin(toRadians(this.pitch));
    front[2] = Math.sin(toRadians(this.yaw)) * Math.cos(toRadians(this.pitch));

    this.cameraFront = vec3.normalize(front);
    this.cameraRight = vec3.normalize(vec3.cross(this.cameraFront, [0, 1, 0]));
    this.cameraUp = vec3.normalize(
      vec3.cross(this.cameraRight, this.cameraFront)
    );
  }

  private onMouseMove(event: MouseEvent) {
    if (document.pointerLockElement === this.gpu.canvas) {
      this.rotateCamera(
        event.movementX * this.sensitivity,
        event.movementY * this.sensitivity
      );
    }
  }

  private processInput(deltaTime: number) {
    let moveDir = vec3.create(0, 0, 0);
    if (this.keys["w"]) {
      moveDir = vec3.add(moveDir, this.cameraFront);
    }
    if (this.keys["s"]) {
      moveDir = vec3.sub(moveDir, this.cameraFront);
    }
    if (this.keys["a"]) {
      moveDir = vec3.sub(moveDir, this.cameraRight);
    }
    if (this.keys["d"]) {
      moveDir = vec3.add(moveDir, this.cameraRight);
    }
    if (this.keys["q"]) {
      moveDir = vec3.sub(moveDir, this.cameraUp);
    }
    if (this.keys["e"]) {
      moveDir = vec3.add(moveDir, this.cameraUp);
    }

    let moveSpeed = this.moveSpeed * deltaTime;
    const moveSpeedMultiplier = 3;
    if (this.keys["shift"]) {
      moveSpeed *= moveSpeedMultiplier;
    }
    if (this.keys["alt"]) {
      moveSpeed /= moveSpeedMultiplier;
    }

    if (vec3.length(moveDir) > 0) {
      const moveAmount = vec3.scale(vec3.normalize(moveDir), moveSpeed);
      this.cameraPos = vec3.add(this.cameraPos, moveAmount);
    }
  }

  onFrame(deltaTime: number) {
    this.processInput(deltaTime);

    const lookPos = vec3.add(this.cameraPos, vec3.scale(this.cameraFront, 1));
    const viewMat = mat4.lookAt(this.cameraPos, lookPos, [0, 1, 0]);
    const viewProjMat = mat4.mul(this.projMat, viewMat);

    this.uniforms.viewProjMat = viewProjMat;
    this.uniforms.viewMat = viewMat;
    this.uniforms.inverseProj = this.invProjMat;

    // 6. Use gpu context for width/height
    this.uniforms.screenSize(this.gpu.canvas.width, this.gpu.canvas.height);
    this.uniforms.near = Camera.nearPlane;
    this.uniforms.far = Camera.farPlane;

    // 7. Use gpu context for writing buffer
    this.gpu.device.queue.writeBuffer(
      this.uniformsBuffer,
      0,
      this.uniforms.buffer
    );
  }
}
