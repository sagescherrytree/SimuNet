// Each vert can be represented as a particle.
struct Particle {
    position      : vec4<f32>,  // 16 bytes
    prevPosition  : vec4<f32>,  // 16 bytes
    velocity      : vec4<f32>,  // 16 bytes
    mass          : f32,        // 4 bytes
    isFixed       : u32,        // 4 bytes
    firstSpringIdx: atomic<u32>,
    springCount: atomic<u32>, 
}

struct VertexIn {
    position : vec4<f32>,
    normal   : vec4<f32>,
};

struct ClothSimParams {
    stiffness: f32,
    mass: f32,
    damping: f32,
    gravity: f32,
    spacingX: f32,
    spacingZ: f32,
    pinningMode: f32
}

@group(0) @binding(0)
var<storage, read> inputVertices: array<VertexIn>;
@group(0) @binding(1)
var<storage, read_write> outputParticles: array<Particle>;
@group(0) @binding(2)
var<uniform> clothParams: ClothSimParams;


@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let index = id.x;

    // Prevent out-of-bounds reads
    if (index >= arrayLength(&inputVertices)) {
        return;
    }

    let vert = inputVertices[index];
    let vertexCount = arrayLength(&inputVertices);

    let gridWidth = u32(sqrt(f32(vertexCount)));
    let gridHeight = vertexCount / gridWidth;
    
    let x = index % gridWidth;
    let y = index / gridWidth;

    var isFixed = 0u;

    let mode = u32(clothParams.pinningMode);
    
    if (mode == 0u) { // Top edge
        isFixed = select(0u, 1u, y == 0u);
    } else if (mode == 1u) { // Top corners
        isFixed = select(0u, 1u, y == 0u && (x == 0u || x == gridWidth - 1u));
    } else if (mode == 2u) { // All edges
        isFixed = select(0u, 1u, x == 0u || x == gridWidth - 1u || y == 0u || y == gridHeight - 1u);
    } else if (mode == 3u) { // Top & bottom edges
        isFixed = select(0u, 1u, y == 0u || y == gridHeight - 1u);
    } else if (mode == 4u) { // Four corners
        isFixed = select(0u, 1u, 
            (x == 0u || x == gridWidth - 1u) && (y == 0u || y == gridHeight - 1u));
    }

    outputParticles[index].position = vert.position;
    outputParticles[index].prevPosition = vert.position;
    outputParticles[index].velocity = vec4<f32>(0.f, 0.f, 0.f, 0.f);
    outputParticles[index].mass = clothParams.mass;
    outputParticles[index].isFixed = isFixed;

    atomicStore(&outputParticles[index].firstSpringIdx, 4294967295u); // max u32
    atomicStore(&outputParticles[index].springCount, 0u); // I think defaults to 0 but making sure
}
