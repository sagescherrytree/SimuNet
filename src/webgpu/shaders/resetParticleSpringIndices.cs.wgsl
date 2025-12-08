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


@group(0) @binding(0)
var<storage, read_write> outputParticles: array<Particle>;



@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let index = id.x;

    // Prevent out-of-bounds
    if (index >= arrayLength(&outputParticles)) {
        return;
    }

    // maybe can just use u32 directly and say equals here? since only one operating on each in this compute shader
    atomicStore(&outputParticles[index].firstSpringIdx, 4294967295u); // max u32
    atomicStore(&outputParticles[index].springCount, 0u);
}
