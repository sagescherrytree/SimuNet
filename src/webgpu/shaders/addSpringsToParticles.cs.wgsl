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
    particleIdx0: u32, // TODO maybe can delete first particle and padding since will be unused in cloth sim
    particleIdx1: u32,
    restLength: f32,  
    padding: f32,
}



@group(0) @binding(0)
var<storage, read> inputSpringParticle0: array<u32>;
@group(0) @binding(1)
var<storage, read> inputSpringParticle1: array<u32>;
@group(0) @binding(2)
var<storage, read> inputSpringRestLength: array<f32>;
@group(0) @binding(3)
var<storage, read_write> outputParticles: array<Particle>;
@group(0) @binding(4)
var<storage, read_write> outputSprings: array<Spring>;


@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let index = id.x;

    // Prevent out-of-bounds reads
    if (index >= arrayLength(&inputSpringParticle0)) {
        return;
    }

    // let spring = inputSpringParticle0[index];
    outputSprings[index].particleIdx0 = inputSpringParticle0[index];
    outputSprings[index].particleIdx1 = inputSpringParticle1[index];
    outputSprings[index].restLength = inputSpringRestLength[index];
    outputSprings[index].padding = 0.0; // probably unneccessary
    atomicMin(&outputParticles[inputSpringParticle0[index]].firstSpringIdx, index);
    atomicAdd(&outputParticles[inputSpringParticle0[index]].springCount, 1);
}
