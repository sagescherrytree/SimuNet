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

struct Spring {
    particleIdx0: u32,
    particleIdx1: u32,
    restLength: f32,  
}



@group(0) @binding(0)
var<storage, read> inputSprings: array<Spring>;
@group(0) @binding(1)
var<storage, read_write> outputParticles: array<Particle>;


@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let index = id.x;

    // Prevent out-of-bounds reads
    if (index >= arrayLength(&inputSprings)) {
        return;
    }

    let spring = inputSprings[index];
    atomicMin(&outputParticles[spring.particleIdx0].firstSpringIdx, index);
    atomicAdd(&outputParticles[spring.particleIdx0].springCount, 1);
}
