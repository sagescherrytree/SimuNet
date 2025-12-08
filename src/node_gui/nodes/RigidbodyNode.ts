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

  private sourceGeometry?: GeometryData; // The single sphere before CopyToPoints
  private instanceCount: number = 1;

  private indexDuplicationPipeline?: GPUComputePipeline;
  private indexDuplicationBindGroupLayout?: GPUBindGroupLayout;
  private indexParamsBuffer?: GPUBuffer;

  transformParamsBuffer: GPUBuffer;

  private isInitialized: boolean = false;

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

    // Detect if this is from CopyToPoints
    this.instanceCount = input.pointCount ?? 1;

    // If from CopyToPoints, we need the source geometry

    console.log(`RigidbodyNode: Detected ${this.instanceCount} instances`);

    this.extractSourceGeometry(input);
    this.isInitialized = false;
    this.initializeRigidbodies()
      .then(() => {
        this.isInitialized = true;
        console.log("RigidbodyNode: Initialization complete!");
        // Trigger an update so the renderer knows we're ready
        this.updateBehavior.triggerUpdate();
      })
      .catch((err) => {
        console.error("RigidbodyNode: Initialization failed:", err);
      });

    // Return undefined for now - geometry will be available after async init
    return undefined;
  }

  private extractSourceGeometry(input: GeometryData) {
    const gpu = GPUContext.getInstance();

    if (this.instanceCount === 1) {
      this.sourceGeometry = input;
      return;
    }

    if (input.sourceGeometry) {
      console.log("Using source geometry from CopyToPoints");
      this.sourceGeometry = input.sourceGeometry as GeometryData;
      return;
    }

    // Calculate vertices per instance
    const totalVertices = input.vertexBuffer.size / (8 * 4);
    const verticesPerInstance = Math.floor(totalVertices / this.instanceCount);
    const totalIndices = input.indexBuffer.size / 4;
    const indicesPerInstance = Math.floor(totalIndices / this.instanceCount);

    console.log(
      `Extracting source: ${verticesPerInstance} verts, ${indicesPerInstance} indices per instance`
    );

    // Create buffers for just the first instance
    const sourceVertexBuffer = gpu.device.createBuffer({
      size: verticesPerInstance * 8 * 4,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.VERTEX |
        GPUBufferUsage.COPY_DST,
    });

    const sourceIndexBuffer = gpu.device.createBuffer({
      size: indicesPerInstance * 4,
      usage:
        GPUBufferUsage.STORAGE | GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST,
    });

    // Copy first instance's data
    const encoder = gpu.device.createCommandEncoder();
    encoder.copyBufferToBuffer(
      input.vertexBuffer,
      0,
      sourceVertexBuffer,
      0,
      verticesPerInstance * 8 * 4
    );
    encoder.copyBufferToBuffer(
      input.indexBuffer,
      0,
      sourceIndexBuffer,
      0,
      indicesPerInstance * 4
    );
    gpu.device.queue.submit([encoder.finish()]);

    this.sourceGeometry = {
      vertexBuffer: sourceVertexBuffer,
      indexBuffer: sourceIndexBuffer,
      id: `${input.id}-source`,
      sourceId: input.sourceId,
      boundingSphere: input.boundingSphere,
      boundingBox: input.boundingBox,
      materialBuffer: input.materialBuffer,
      pointAttributeBuffer: input.pointAttributeBuffer,
    };
  }

  async setInputGeometry(geometry: GeometryData, index: number = 0) {
    this.inputGeometry = geometry;
    await this.applyModification(geometry);
  }

  async initializeRigidbodies() {
    if (!this.inputGeometry || !this.sourceGeometry) {
      console.error("RigidbodyNode: No input or source geometry!");
      return;
    }

    console.log(
      `RigidbodyNode: Initializing ${this.instanceCount} rigidbodies...`
    );

    const gpu = GPUContext.getInstance();

    const bufferSize = RigidbodyCPU.STRIDE * this.instanceCount;

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

    this.timeUniformBuffer = gpu.device.createBuffer({
      size: 4,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    this.updateSimParamsBuffer();
    await this.initializeRigidbodiesOnCPU();
    this.setupComputePipeline();

    // Output buffer for ALL instances
    const verticesPerInstance = this.sourceGeometry.vertexBuffer.size / (8 * 4);
    const totalVertices = verticesPerInstance * this.instanceCount;

    this.outputVertexBuffer = gpu.device.createBuffer({
      label: "Rigidbody output vertex buffer",
      size: totalVertices * 8 * 4,
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.VERTEX |
        GPUBufferUsage.COPY_SRC,
    });

    // Need to duplicate indices for each instance
    const indicesPerInstance = this.sourceGeometry.indexBuffer.size / 4;
    const totalIndices = indicesPerInstance * this.instanceCount;

    this.outputIndexBuffer = gpu.device.createBuffer({
      size: totalIndices * 4,
      usage:
        GPUBufferUsage.STORAGE | GPUBufferUsage.INDEX | GPUBufferUsage.COPY_SRC,
    });

    this.setupTransformPipeline();
    this.setupIndexDuplicationPipeline();

    this.geometry = {
      vertexBuffer: this.outputVertexBuffer,
      indexBuffer: this.outputIndexBuffer,
      wireframeIndexBuffer: this.inputGeometry.wireframeIndexBuffer,
      id: this.id,
      sourceId: this.inputGeometry.sourceId ?? this.inputGeometry.id,
      materialBuffer: this.inputGeometry.materialBuffer,
      pointCount: this.instanceCount,
      instancePositions: this.inputGeometry.instancePositions,
    };

    console.log(
      `RigidbodyNode: Created geometry with ${this.instanceCount} rigidbodies`
    );

    this.runInitialTransform();
    this.runIndexDuplication();
  }

  private async initializeRigidbodiesOnCPU() {
    const gpu = GPUContext.getInstance();
    const spawnVel = this.initialVelocityControl.value;

    const boundingSphere = this.sourceGeometry.boundingSphere;
    if (!boundingSphere) {
      console.error("Source geometry has no bounding sphere!");
      return;
    }

    const center = boundingSphere.center;
    const baseRadius = boundingSphere.radius;
    const positions = this.inputGeometry.instancePositions || [[0, 0, 0]];

    let pscales: Float32Array | null = null;
    if (this.inputGeometry.pointAttributeBuffer) {
      const attribBuffer = this.inputGeometry.pointAttributeBuffer;
      const readBuffer = gpu.device.createBuffer({
        size: attribBuffer.size,
        usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      });

      const encoder = gpu.device.createCommandEncoder();
      encoder.copyBufferToBuffer(
        attribBuffer,
        0,
        readBuffer,
        0,
        attribBuffer.size
      );
      gpu.device.queue.submit([encoder.finish()]);

      await readBuffer.mapAsync(GPUMapMode.READ);
      const attribData = new Float32Array(readBuffer.getMappedRange());

      // Extract pscale values (first float of each 9-float attribute block)
      pscales = new Float32Array(this.instanceCount);
      for (let i = 0; i < this.instanceCount; i++) {
        pscales[i] = attribData[i * 9]; // pscale is at index 0 of each block
      }

      readBuffer.unmap();
      console.log("RigidbodyNode: Read pscale values", pscales);

      console.log(
        "RigidbodyNode: Point attribute buffer size:",
        attribBuffer.size
      );
      console.log(
        "RigidbodyNode: Expected size for",
        this.instanceCount,
        "instances:",
        this.instanceCount * 9 * 4,
        "bytes"
      );
      console.log("RigidbodyNode: Read pscale values:");
      for (let i = 0; i < this.instanceCount; i++) {
        console.log(
          `  Instance ${i}: pscale=${pscales[i]}, reading from index ${i * 9}`
        );
      }
    } else {
      console.warn(
        "RigidbodyNode: No pointAttributeBuffer found, using default scale of 1.0"
      );
    }

    const cpuBody = new RigidbodyCPU(this.instanceCount);

    for (let i = 0; i < this.instanceCount; i++) {
      const pos = positions[i] || [0, 0, 0];
      const pscale = pscales ? pscales[i] : 1.0;
      const radius = baseRadius * pscale;

      // Adjust initial Y position to account for center offset
      // If the mesh center is at y=0.5, we need to shift rigidbody down by 0.5
      const adjustedY = pos[1] - center[1];

      cpuBody.writeRigidbody(i, {
        position: { x: pos[0], y: adjustedY, z: pos[2] },
        velocity: spawnVel,
        mass: this.massControl.value,
        radius: radius,
      });
    }

    gpu.device.queue.writeBuffer(this.rigidbodyBuffer1, 0, cpuBody.buffer);
    gpu.device.queue.writeBuffer(this.rigidbodyBuffer2, 0, cpuBody.buffer);

    // Store the original center for offset calculations
    this.originalCenterBuffer = gpu.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    gpu.device.queue.writeBuffer(
      this.originalCenterBuffer,
      0,
      new Float32Array([center[0], center[1], center[2], 1.0])
    );
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
  
  struct TransformParams {
    verticesPerInstance: u32,
    instanceCount: u32,
    baseRadius: f32,
    padding2: u32,
  }
  
  @group(0) @binding(0)
  var<storage, read> rigidbodies: array<Rigidbody>;
  
  @group(0) @binding(1)
  var<storage, read> sourceMesh: array<Vertex>;
  
  @group(0) @binding(2)
  var<storage, read_write> outputVertices: array<Vertex>;
  
  @group(0) @binding(3)
  var<storage, read> originalCenter: vec4<f32>;
  
  @group(0) @binding(4)
  var<uniform> params: TransformParams;
  
  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let globalVertexIndex = id.x;
    
    // Total vertices = verticesPerInstance * instanceCount
    let totalVertices = params.verticesPerInstance * params.instanceCount;
    if (globalVertexIndex >= totalVertices) {
      return;
    }
    
    // Figure out which instance this vertex belongs to
    let instanceIndex = globalVertexIndex / params.verticesPerInstance;
    
    // Get the local vertex index within the source mesh
    let localVertexIndex = globalVertexIndex % params.verticesPerInstance;
    
    // Get the rigidbody for this instance
    let body = rigidbodies[instanceIndex];
    
    // Get the vertex from the source mesh (single sphere)
    let sourceVert = sourceMesh[localVertexIndex];
    
    // Calculate offset from original center
    let offset = sourceVert.position.xyz - originalCenter.xyz;

    let scaleFactor = body.radius / params.baseRadius;
    let scaledOffset = offset * scaleFactor;
    
    // Apply offset to rigidbody's current position
    let newPos = body.position.xyz + scaledOffset;
    
    var outputVert = sourceVert;
    outputVert.position = vec4<f32>(newPos, 1.0);
    
    outputVertices[globalVertexIndex] = outputVert;
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
        }, // rigidbodies
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        }, // source mesh
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        }, // output vertices
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        }, // original center
        {
          binding: 4,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        }, // params
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

    // Create params buffer
    const verticesPerInstance = this.sourceGeometry.vertexBuffer.size / (8 * 4);
    const baseRadius = this.sourceGeometry.boundingSphere.radius;

    const paramsBuffer = new ArrayBuffer(16); // 4 floats = 16 bytes
    const uint32View = new Uint32Array(paramsBuffer);
    const float32View = new Float32Array(paramsBuffer);

    uint32View[0] = verticesPerInstance; // u32
    uint32View[1] = this.instanceCount; // u32
    float32View[2] = baseRadius; // f32 (same offset, different view)
    uint32View[3] = 0;

    this.transformParamsBuffer = gpu.device.createBuffer({
      size: 16,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    gpu.device.queue.writeBuffer(this.transformParamsBuffer, 0, paramsBuffer);
  }

  setupIndexDuplicationPipeline() {
    const gpu = GPUContext.getInstance();

    const shaderCode = `
  struct IndexParams {
    indicesPerInstance: u32,
    verticesPerInstance: u32,
    instanceCount: u32,
    padding: u32,
  }
  
  @group(0) @binding(0)
  var<storage, read> sourceIndices: array<u32>;
  
  @group(0) @binding(1)
  var<storage, read_write> outputIndices: array<u32>;
  
  @group(0) @binding(2)
  var<uniform> params: IndexParams;
  
  @compute @workgroup_size(64)
  fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let globalIndexIndex = id.x;
    let totalIndices = params.indicesPerInstance * params.instanceCount;
    
    if (globalIndexIndex >= totalIndices) {
      return;
    }
    
    // Which instance does this index belong to?
    let instanceIndex = globalIndexIndex / params.indicesPerInstance;
    
    // Local index within source indices
    let localIndex = globalIndexIndex % params.indicesPerInstance;
    
    // Read source index and add vertex offset for this instance
    let srcIndex = sourceIndices[localIndex];
    let vertexOffset = instanceIndex * params.verticesPerInstance;
    
    outputIndices[globalIndexIndex] = srcIndex + vertexOffset;
  }
  `;

    const shaderModule = gpu.device.createShaderModule({
      label: "index duplication shader",
      code: shaderCode,
    });

    this.indexDuplicationBindGroupLayout = gpu.device.createBindGroupLayout({
      label: "index duplication BGL",
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
      ],
    });

    const pipelineLayout = gpu.device.createPipelineLayout({
      bindGroupLayouts: [this.indexDuplicationBindGroupLayout],
    });

    this.indexDuplicationPipeline = gpu.device.createComputePipeline({
      label: "index duplication pipeline",
      layout: pipelineLayout,
      compute: { module: shaderModule, entryPoint: "main" },
    });

    // Create params buffer
    const indicesPerInstance = this.sourceGeometry.indexBuffer.size / 4;
    const verticesPerInstance = this.sourceGeometry.vertexBuffer.size / (8 * 4);

    const paramsData = new Uint32Array([
      indicesPerInstance,
      verticesPerInstance,
      this.instanceCount,
      0,
    ]);

    this.indexParamsBuffer = gpu.device.createBuffer({
      size: paramsData.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    gpu.device.queue.writeBuffer(this.indexParamsBuffer, 0, paramsData);
  }

  runIndexDuplication() {
    const gpu = GPUContext.getInstance();

    const bindGroup = gpu.device.createBindGroup({
      layout: this.indexDuplicationBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.sourceGeometry.indexBuffer } },
        { binding: 1, resource: { buffer: this.outputIndexBuffer } },
        { binding: 2, resource: { buffer: this.indexParamsBuffer } },
      ],
    });

    const encoder = gpu.device.createCommandEncoder();
    const pass = encoder.beginComputePass();

    pass.setPipeline(this.indexDuplicationPipeline);
    pass.setBindGroup(0, bindGroup);

    const totalIndices =
      (this.sourceGeometry.indexBuffer.size / 4) * this.instanceCount;
    const workgroups = Math.ceil(totalIndices / this.workgroupSize);
    pass.dispatchWorkgroups(workgroups);

    pass.end();
    gpu.device.queue.submit([encoder.finish()]);

    console.log(
      `Index duplication complete: ${totalIndices} indices for ${this.instanceCount} instances`
    );
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
        { binding: 1, resource: { buffer: this.sourceGeometry.vertexBuffer } },
        { binding: 2, resource: { buffer: this.outputVertexBuffer } },
        { binding: 3, resource: { buffer: this.originalCenterBuffer } },
        { binding: 4, resource: { buffer: this.transformParamsBuffer } },
      ],
    });

    pass.setPipeline(this.transformMeshPipeline);
    pass.setBindGroup(0, transformBindGroup);

    const sphereVertexCount =
      (this.sourceGeometry.vertexBuffer.size / (8 * 4)) * this.instanceCount;
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
    if (!this.isInitialized) {
      console.log("RigidbodyNode: Still initializing, skipping frame");
      return;
    }

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
    const simWorkgroups = Math.ceil(this.instanceCount / this.workgroupSize);
    pass.dispatchWorkgroups(simWorkgroups);

    [this.currentReadBuffer, this.currentWriteBuffer] = [
      this.currentWriteBuffer,
      this.currentReadBuffer,
    ];

    const transformBindGroup = gpu.device.createBindGroup({
      layout: this.transformBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.currentReadBuffer } },
        { binding: 1, resource: { buffer: this.sourceGeometry.vertexBuffer } },
        { binding: 2, resource: { buffer: this.outputVertexBuffer } },
        { binding: 3, resource: { buffer: this.originalCenterBuffer } },
        { binding: 4, resource: { buffer: this.transformParamsBuffer } },
      ],
    });

    pass.setPipeline(this.transformMeshPipeline);
    pass.setBindGroup(0, transformBindGroup);

    const sphereVertexCount =
      (this.sourceGeometry.vertexBuffer.size / (8 * 4)) * this.instanceCount;
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

    this.geometry = await this.applyModification(geom);
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
