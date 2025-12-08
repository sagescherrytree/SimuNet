import { Node } from "./Node";
import { GeometryData } from "../geometry/geometry";
import { NumberControl } from "../controls/NumberControl";
import { Vec3Control, Vec3 } from "../controls/Vec3Control";
import { GPUContext } from "../../webgpu/GPUContext";
import rigidbodySimShader from "../../webgpu/shaders/rigidbodySim.cs.wgsl";
import { IGeometryModifier } from "../interfaces/NodeCapabilities";

// CPU-side rigidbody for initialization
class RigidbodyCPU {
  static readonly STRIDE = 48; // 48 bytes: position(16) + velocity(16) + mass(4) + radius(4) + padding(8)

  buffer: ArrayBuffer;
  floatView: Float32Array;

  constructor(count: number) {
    this.buffer = new ArrayBuffer(count * RigidbodyCPU.STRIDE);
    this.floatView = new Float32Array(this.buffer);
  }

  writeRigidbody(
    i: number,
    data: {
      position: Vec3;
      velocity?: Vec3;
      mass: number;
      radius: number;
    }
  ) {
    const base = (RigidbodyCPU.STRIDE / 4) * i;

    // position (vec4)
    this.floatView[base + 0] = data.position.x;
    this.floatView[base + 1] = data.position.y;
    this.floatView[base + 2] = data.position.z;
    this.floatView[base + 3] = 0;

    // velocity (vec4)
    const vel = data.velocity ?? { x: 0, y: 0, z: 0 };
    this.floatView[base + 4] = vel.x;
    this.floatView[base + 5] = vel.y;
    this.floatView[base + 6] = vel.z;
    this.floatView[base + 7] = 0;

    // mass, radius, padding
    this.floatView[base + 8] = data.mass;
    this.floatView[base + 9] = data.radius;
    this.floatView[base + 10] = 0;
    this.floatView[base + 11] = 0;
  }
}

export class RigidbodyNode extends Node implements IGeometryModifier {
  public inputGeometry?: GeometryData;

  rigidbodyBuffer1: GPUBuffer;
  rigidbodyBuffer2: GPUBuffer;
  private currentReadBuffer: GPUBuffer;
  private currentWriteBuffer: GPUBuffer;

  simParamsBuffer: GPUBuffer;
  timeUniformBuffer: GPUBuffer;

  private outputVertexBuffer: GPUBuffer;
  private outputIndexBuffer: GPUBuffer;

  rigidbodySimPipeline: GPUComputePipeline;
  rigidbodySimBindGroupLayout: GPUBindGroupLayout;
  transformMeshPipeline?: GPUComputePipeline;
  private transformBindGroupLayout: GPUBindGroupLayout;
  private originalCenterBuffer: GPUBuffer;

  workgroupSize = 64;

  massControl: NumberControl;
  gravityControl: NumberControl;
  dampingControl: NumberControl;
  restitutionControl: NumberControl;
  initialVelocityControl: Vec3Control;

  constructor() {
    super("Rigidbody");

    this.ioBehavior.addGeometryInput();
    this.ioBehavior.addGeometryOutput();

    const onChange = () => {
      if (this.inputGeometry) {
        this.applyModification(this.inputGeometry);
      }
      this.updateBehavior.triggerUpdate();
    };

    this.massControl = new NumberControl("Mass", 1.0, onChange, 0.1, 0.1, 10);
    this.gravityControl = new NumberControl(
      "Gravity",
      9.8,
      onChange,
      0.1,
      0,
      50
    );
    this.dampingControl = new NumberControl(
      "Damping",
      0.01,
      onChange,
      0.01,
      0,
      0.99
    );
    this.restitutionControl = new NumberControl(
      "Bounciness",
      0.7,
      onChange,
      0.1,
      0,
      1
    );
    this.initialVelocityControl = new Vec3Control(
      "Initial Velocity",
      { x: 0, y: 0, z: 0 },
      onChange
    );
  }

  applyModification(input: GeometryData): GeometryData | undefined {
    console.log("RigidbodyNode.applyModification() called");

    if (!input) {
      console.warn("RigidbodyNode: No input geometry");
      return undefined;
    }

    this.inputGeometry = input;
    this.initializeRigidbodies();

    return this.geometry;
  }

  setInputGeometry(geometry: GeometryData, index: number = 0) {
    this.inputGeometry = geometry;
    this.applyModification(geometry);
  }

  initializeRigidbodies() {
    if (!this.inputGeometry) {
      console.error("RigidbodyNode: No input geometry!");
      return;
    }

    console.log("RigidbodyNode: Starting initialization...");

    const gpu = GPUContext.getInstance();

    const sphereVertexCount = this.inputGeometry.vertexBuffer.size / (8 * 4);

    const bufferSize = RigidbodyCPU.STRIDE;

    this.rigidbodyBuffer1 = gpu.device.createBuffer({
      size: bufferSize,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC,
      label: "Rigidbody Buffer 1",
    });

    this.rigidbodyBuffer2 = gpu.device.createBuffer({
      size: bufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      label: "Rigidbody Buffer 2",
    });

    this.currentReadBuffer = this.rigidbodyBuffer1;
    this.currentWriteBuffer = this.rigidbodyBuffer2;

    // uniform buffers
    this.timeUniformBuffer = gpu.device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.updateSimParamsBuffer();

    this.initializeRigidbodyOnCPU();

    this.setupComputePipeline();

    this.outputVertexBuffer = gpu.device.createBuffer({
      label: "Rigidbody output vertex buffer",
      size: sphereVertexCount * 8 * 4,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.VERTEX |
        GPUBufferUsage.COPY_SRC,
    });

    this.outputIndexBuffer = this.inputGeometry.indexBuffer;

    this.setupTransformPipeline();

    this.geometry = {
      vertexBuffer: this.outputVertexBuffer,
      indexBuffer: this.outputIndexBuffer,
      wireframeIndexBuffer: this.inputGeometry.wireframeIndexBuffer,
      id: this.id,
      sourceId: this.inputGeometry.sourceId ?? this.inputGeometry.id,
      materialBuffer: this.inputGeometry.materialBuffer,
    };

    console.log("RigidbodyNode: Created geometry with single rigidbody");

    this.runInitialTransform();
  }

  private initializeRigidbodyOnCPU() {
    const gpu = GPUContext.getInstance();
    const spawnVel = this.initialVelocityControl.value;

    // uses the bounding sphere rather than get it from gpu
    const boundingSphere = this.inputGeometry.boundingSphere;
    if (!boundingSphere) {
      console.error("Input geometry has no bounding sphere!");
      return;
    }

    const center = boundingSphere.center;
    const radius = boundingSphere.radius;

    console.log("Using bounding sphere - Center:", center, "Radius:", radius);

    // Create center buffer and write CPU-calculated center
    this.originalCenterBuffer = gpu.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    gpu.device.queue.writeBuffer(
      this.originalCenterBuffer,
      0,
      new Float32Array([center[0], center[1], center[2], 1.0])
    );

    // Create rigidbody with CPU-calculated values
    const cpuBody = new RigidbodyCPU(1);
    cpuBody.writeRigidbody(0, {
      position: { x: center[0], y: center[1], z: center[2] },
      velocity: spawnVel,
      mass: this.massControl.value,
      radius: radius,
    });

    // Create and upload buffers
    this.rigidbodyBuffer1 = gpu.device.createBuffer({
      size: RigidbodyCPU.STRIDE,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_DST |
        GPUBufferUsage.COPY_SRC,
    });

    this.rigidbodyBuffer2 = gpu.device.createBuffer({
      size: RigidbodyCPU.STRIDE,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    gpu.device.queue.writeBuffer(this.rigidbodyBuffer1, 0, cpuBody.buffer);
    gpu.device.queue.writeBuffer(this.rigidbodyBuffer2, 0, cpuBody.buffer);

    this.currentReadBuffer = this.rigidbodyBuffer1;
    this.currentWriteBuffer = this.rigidbodyBuffer2;
  }

  setupTransformPipeline() {
    const gpu = GPUContext.getInstance();

    const shaderCode = `
    struct Rigidbody {
      position: vec4<f32>,
      velocity: vec4<f32>,
      mass: f32,
      radius: f32,
      padding1: f32,
      padding2: f32,
    }
    
    struct Vertex {
      position: vec4<f32>,
      normal: vec4<f32>,
    }
    
    @group(0) @binding(0)
    var<storage, read> rigidbodies: array<Rigidbody>;
    
    @group(0) @binding(1)
    var<storage, read> originalMesh: array<Vertex>;
    
    @group(0) @binding(2)
    var<storage, read_write> outputVertices: array<Vertex>;
    
    @group(0) @binding(3)
    var<storage, read> originalCenter: vec4<f32>;
    
    @compute @workgroup_size(64)
    fn main(@builtin(global_invocation_id) id: vec3<u32>) {
      let index = id.x;
      if (index >= arrayLength(&originalMesh)) {
        return;
      }
      
      let body = rigidbodies[0];
      let originalVert = originalMesh[index];
      
      // Calculate offset from stored center
      let offset = originalVert.position.xyz - originalCenter.xyz;
      
      // Apply offset to new rigidbody position
      let newPos = body.position.xyz + offset;
      
      var outputVert = originalVert;
      outputVert.position = vec4<f32>(newPos, 1.0);
      
      outputVertices[index] = outputVert;
    }
  `;

    const shaderModule = gpu.device.createShaderModule({
      label: "rigidbody transform shader",
      code: shaderCode,
    });

    this.transformBindGroupLayout = gpu.device.createBindGroupLayout({
      label: "rigidbody transform BGL",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
      ],
    });

    const pipelineLayout = gpu.device.createPipelineLayout({
      bindGroupLayouts: [this.transformBindGroupLayout],
    });

    this.transformMeshPipeline = gpu.device.createComputePipeline({
      label: "rigidbody transform pipeline",
      layout: pipelineLayout,
      compute: { module: shaderModule, entryPoint: "main" },
    });
  }

  updateSimParamsBuffer() {
    const gpu = GPUContext.getInstance();

    const data = new Float32Array([
      0,
      -this.gravityControl.value,
      0,
      0,
      this.dampingControl.value,
      this.restitutionControl.value,
      0,
      0,
    ]);

    if (!this.simParamsBuffer) {
      this.simParamsBuffer = gpu.device.createBuffer({
        size: data.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    }

    gpu.device.queue.writeBuffer(this.simParamsBuffer, 0, data);
  }

  setupComputePipeline() {
    const gpu = GPUContext.getInstance();

    this.rigidbodySimBindGroupLayout = gpu.device.createBindGroupLayout({
      label: "rigidbody sim BGL",
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
      ],
    });

    const shaderModule = gpu.device.createShaderModule({
      label: "rigidbody sim shader",
      code: rigidbodySimShader,
    });

    const pipelineLayout = gpu.device.createPipelineLayout({
      label: "rigidbody sim layout",
      bindGroupLayouts: [this.rigidbodySimBindGroupLayout],
    });

    this.rigidbodySimPipeline = gpu.device.createComputePipeline({
      label: "rigidbody sim pipeline",
      layout: pipelineLayout,
      compute: { module: shaderModule, entryPoint: "main" },
    });
  }

  private runInitialTransform() {
    const gpu = GPUContext.getInstance();

    const encoder = gpu.device.createCommandEncoder();
    const pass = encoder.beginComputePass();

    const transformBindGroup = gpu.device.createBindGroup({
      layout: this.transformBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.currentReadBuffer } },
        { binding: 1, resource: { buffer: this.inputGeometry.vertexBuffer } },
        { binding: 2, resource: { buffer: this.outputVertexBuffer } },
        { binding: 3, resource: { buffer: this.originalCenterBuffer } },
      ],
    });

    pass.setPipeline(this.transformMeshPipeline);
    pass.setBindGroup(0, transformBindGroup);

    const sphereVertexCount = this.inputGeometry.vertexBuffer.size / (8 * 4);
    const transformWorkgroups = Math.ceil(
      sphereVertexCount / this.workgroupSize
    );
    pass.dispatchWorkgroups(transformWorkgroups);

    pass.end();
    gpu.device.queue.submit([encoder.finish()]);
  }

  public updateSim(deltaTime: number) {
    if (!this.timeUniformBuffer) {
      console.log("RigidbodyNode: No time uniform buffer!");
      return;
    }

    this.updateSimParamsBuffer();

    const dtSeconds = Math.min(deltaTime / 1000.0, 0.016);
    const gpu = GPUContext.getInstance();
    gpu.device.queue.writeBuffer(
      this.timeUniformBuffer,
      0,
      new Float32Array([dtSeconds])
    );
  }

  public dispatchSim(pass: GPUComputePassEncoder) {
    if (!this.rigidbodySimPipeline || !this.currentReadBuffer) {
      console.log(
        "RigidbodyNode: Cannot dispatch - missing pipeline or buffer"
      );
      return;
    }

    const gpu = GPUContext.getInstance();

    const bindGroup = gpu.device.createBindGroup({
      layout: this.rigidbodySimBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.currentReadBuffer } },
        { binding: 1, resource: { buffer: this.currentWriteBuffer } },
        { binding: 2, resource: { buffer: this.simParamsBuffer } },
        { binding: 3, resource: { buffer: this.timeUniformBuffer } },
      ],
    });

    pass.setPipeline(this.rigidbodySimPipeline);
    pass.setBindGroup(0, bindGroup);
    pass.dispatchWorkgroups(1);

    [this.currentReadBuffer, this.currentWriteBuffer] = [
      this.currentWriteBuffer,
      this.currentReadBuffer,
    ];

    const transformBindGroup = gpu.device.createBindGroup({
      layout: this.transformBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.currentReadBuffer } },
        { binding: 1, resource: { buffer: this.inputGeometry.vertexBuffer } },
        { binding: 2, resource: { buffer: this.outputVertexBuffer } },
        { binding: 3, resource: { buffer: this.originalCenterBuffer } },
      ],
    });

    pass.setPipeline(this.transformMeshPipeline);
    pass.setBindGroup(0, transformBindGroup);

    const sphereVertexCount = this.inputGeometry.vertexBuffer.size / (8 * 4);
    const transformWorkgroups = Math.ceil(
      sphereVertexCount / this.workgroupSize
    );
    pass.dispatchWorkgroups(transformWorkgroups);
  }

  async execute(inputs?: Record<string, any>) {
    const geom = inputs?.geometry?.[0] as GeometryData;
    if (!geom) {
      console.error("RigidbodyNode: No input geometry in execute()");
      return;
    }

    this.geometry = this.applyModification(geom);
    return { geometry: this.geometry };
  }

  getEditableControls() {
    return {
      mass: this.massControl,
      gravity: this.gravityControl,
      damping: this.dampingControl,
      bounciness: this.restitutionControl,
      initialVelocity: this.initialVelocityControl,
    };
  }
}
