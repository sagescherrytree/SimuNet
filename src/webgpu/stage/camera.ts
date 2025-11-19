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
  panSpeed: number = 0.005;
  zoomSpeed: number = 0.1;
  sensitivity: number = 0.15;

  static readonly nearPlane = 0.1;
  static readonly farPlane = 1000;
  static readonly fovYDegrees = 45; // Moved here as a static constant

  private isRightMouseDown: boolean = false;
  private isMiddleMouseDown: boolean = false;
  private leftClickStartPos: { x: number; y: number } | null = null;

  onFocusRequested?: () => void;
  onObjectClick?: (ray: { origin: Vec3; direction: Vec3 }) => void;

  keys: { [key: string]: boolean } = {};

  private gpu: GPUContext;

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

    this.gpu.addResizeCallback((newAspect) => {
      this.recalculateProjection(newAspect);
    });

    // 4. Event Listeners
    window.addEventListener("keydown", (event) => this.onKeyEvent(event, true));
    window.addEventListener("keyup", (event) => this.onKeyEvent(event, false));
    window.onblur = () => {
      this.keys = {};
      this.isRightMouseDown = false;
      this.isMiddleMouseDown = false;
    };

    // 5. Canvas Event Listeners (Use this.gpu.canvas)
    this.gpu.canvas.addEventListener("mousedown", (e) => this.onMouseDown(e));
    this.gpu.canvas.addEventListener("mouseup", (e) => this.onMouseUp(e));
    this.gpu.canvas.addEventListener("mousemove", (e) => this.onMouseMove(e));
    this.gpu.canvas.addEventListener("wheel", (e) => this.onWheel(e));
    this.gpu.canvas.addEventListener("contextmenu", (e) => this.onContextMenu(e));
  }

  public recalculateProjection(aspectRatio: number) {
    this.projMat = mat4.perspective(
      toRadians(Camera.fovYDegrees),
      aspectRatio,
      Camera.nearPlane,
      Camera.farPlane
    );

    this.invProjMat = mat4.inverse(this.projMat);
  }

  private onKeyEvent(event: KeyboardEvent, down: boolean) {
    const key = event.key.toLowerCase();
    this.keys[key] = down;

    if (down && key === "f") {
      if (this.onFocusRequested) {
        this.onFocusRequested();
      }
      event.preventDefault();
    }

    if (this.keys["alt"]) {
      event.preventDefault();
    }
  }

  private onContextMenu(event: MouseEvent) {
    event.preventDefault();
  }

  private onMouseDown(event: MouseEvent) {
    if (event.button === 0) {
      // Store click position to check if it's a drag or click
      this.leftClickStartPos = { x: event.clientX, y: event.clientY };
      this.isMiddleMouseDown = true;
      event.preventDefault();
    }
    // Right mouse button (2) rotates
    if (event.button === 2) {
      this.isRightMouseDown = true;
      this.gpu.canvas.requestPointerLock();
    }
    // Middle mouse button (1) pans
    else if (event.button === 1) {
      this.isMiddleMouseDown = true;
      event.preventDefault();
    }
  }

  private onMouseUp(event: MouseEvent) {
    if (event.button === 2) {
      this.isRightMouseDown = false;
      document.exitPointerLock();
    } else if (event.button === 1) {
      this.isMiddleMouseDown = false;
    } else if (event.button === 0) {
      if (this.leftClickStartPos) {
        const dx = Math.abs(event.clientX - this.leftClickStartPos.x);
        const dy = Math.abs(event.clientY - this.leftClickStartPos.y);
        const dragThreshold = 5; // pixels

        // Only trigger selection if mouse didn't move much
        if (dx < dragThreshold && dy < dragThreshold) {
          this.handleObjectSelection(event);
        }
      }
      this.isMiddleMouseDown = false;
      this.leftClickStartPos = null;
    }
  }

  private onMouseMove(event: MouseEvent) {
    // Right mouse button rotates
    if (
      this.isRightMouseDown &&
      document.pointerLockElement === this.gpu.canvas
    ) {
      this.rotateCamera(
        event.movementX * this.sensitivity,
        event.movementY * this.sensitivity
      );
    }
    // Middle mouse button pans
    else if (this.isMiddleMouseDown) {
      this.panCamera(event.movementX, event.movementY);
    }
  }

  private onWheel(event: WheelEvent) {
    event.preventDefault();

    // Zoom by moving camera forward/backward along view direction
    const zoomAmount = -event.deltaY * this.zoomSpeed * 0.01;
    this.cameraPos = vec3.add(
      this.cameraPos,
      vec3.scale(this.cameraFront, zoomAmount)
    );
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

  private panCamera(dx: number, dy: number) {
    // Pan the camera perpendicular to view direction
    const panX = vec3.scale(this.cameraRight, -dx * this.panSpeed);
    const panY = vec3.scale(this.cameraUp, dy * this.panSpeed);

    this.cameraPos = vec3.add(this.cameraPos, panX);
    this.cameraPos = vec3.add(this.cameraPos, panY);
  }

  getRayFromMouse(
    mouseX: number,
    mouseY: number
  ): { origin: Vec3; direction: Vec3 } {
    const canvas = this.gpu.canvas;
    const rect = canvas.getBoundingClientRect();

    // Convert to normalized device coordinates (-1 to +1)
    const x = ((mouseX - rect.left) / rect.width) * 2 - 1;
    const y = -(((mouseY - rect.top) / rect.height) * 2 - 1); // Y is flipped

    // Ray in normalized device coordinates
    const rayNDC = vec3.create(x, y, 1);

    // Transform through inverse projection to get view space direction
    // We need to manually do the matrix-vector multiplication
    const rayClip = vec3.create(x, y, -1);

    // Get view matrix
    const lookPos = vec3.add(this.cameraPos, this.cameraFront);
    const viewMat = mat4.lookAt(this.cameraPos, lookPos, [0, 1, 0]);
    const invViewMat = mat4.inverse(viewMat);

    // Transform ray direction from clip space to world space
    // For direction vectors, we only care about rotation (not translation)
    const rayEye = vec3.create(
      this.invProjMat[0] * rayClip[0],
      this.invProjMat[5] * rayClip[1],
      -1.0
    );

    // Transform from view space to world space
    const rayWorld = vec3.create(
      invViewMat[0] * rayEye[0] +
        invViewMat[4] * rayEye[1] +
        invViewMat[8] * rayEye[2],
      invViewMat[1] * rayEye[0] +
        invViewMat[5] * rayEye[1] +
        invViewMat[9] * rayEye[2],
      invViewMat[2] * rayEye[0] +
        invViewMat[6] * rayEye[1] +
        invViewMat[10] * rayEye[2]
    );

    return {
      origin: this.cameraPos,
      direction: vec3.normalize(rayWorld),
    };
  }

  private handleObjectSelection(event: MouseEvent) {
    const ray = this.getRayFromMouse(event.clientX, event.clientY);

    if (this.onObjectClick) {
      this.onObjectClick(ray);
    }
  }

  public focusOnPoint(point: Vec3, distance: number = 10) {
    const offset = vec3.scale(this.cameraFront, -distance);
    this.cameraPos = vec3.add(point, offset);
  }

  private processInput(deltaTime: number) {
    if (!this.isRightMouseDown) {
      return;
    }

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
