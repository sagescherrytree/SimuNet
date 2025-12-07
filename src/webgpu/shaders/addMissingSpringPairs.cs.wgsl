// Each vert can be represented as a particle.
struct Particle {
    position      : vec4<f32>,  // 16 bytes
    prevPosition  : vec4<f32>,  // 16 bytes
    velocity      : vec4<f32>,  // 16 bytes
    mass          : f32,        // 4 bytes
    isFixed       : u32,        // 4 bytes
    firstSpringIdx: u32,
    springCount: u32, 
}

struct Spring {
    particleIdx0: u32, // TODO maybe can delete first particle and padding since will be unused in cloth sim
    particleIdx1: u32,
    restLength: f32,  
    padding: f32,
}




// first half of array (up to totalSpringCount) to be used as input, output to second half
@group(0) @binding(0)
var<storage, read_write> inputOutputSpringParticle0: array<u32>;
@group(0) @binding(1)
var<storage, read_write> copyInputOutputSpringParticle0: array<u32>;
@group(0) @binding(2)
var<storage, read_write> inputOutputSpringParticle1: array<u32>;
@group(0) @binding(3)
var<storage, read_write> inputOutputSpringRestLength: array<f32>;
@group(0) @binding(4)
var<storage, read> inputParticles: array<Particle>;
// @group(0) @binding(4)
// var<storage, read_write> outputSprings: array<Spring>;
@group(0) @binding(5)
var<storage, read> totalSpringCount: u32;
@group(0) @binding(6)
var<storage, read_write> outputSpringCount: atomic<u32>;


@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let index = id.x;

    // Prevent out-of-bounds reads
    // if (index >= arrayLength(&inputSpringParticle0)) { // only working with half of array on first pass
    if (index >= totalSpringCount) {
        return;
    }

    let firstParticleIdx = inputOutputSpringParticle0[index];
    let secondParticleIdx = inputOutputSpringParticle1[index];
    let p = &(inputParticles[secondParticleIdx]);
    var hasMirror = false;
    for (var i = (*p).firstSpringIdx; i < (*p).firstSpringIdx + (*p).springCount; i++) {
        if (firstParticleIdx == inputOutputSpringParticle1[i]) {
            // particle has mirror of spring already
            hasMirror = true;
            break;
        }
    }
    let targetIdx = index + totalSpringCount;
    if (hasMirror) {
        // fill in with dummy data to sort to end--max u32 value
        inputOutputSpringParticle0[targetIdx] = 4294967295u;
        inputOutputSpringParticle1[targetIdx] = 4294967295u;
        copyInputOutputSpringParticle0[targetIdx] = 4294967295u;
        inputOutputSpringRestLength[targetIdx] = 0;
    } else {
        // make copy in other direction
        inputOutputSpringParticle0[targetIdx] = secondParticleIdx;
        copyInputOutputSpringParticle0[targetIdx] = secondParticleIdx;
        inputOutputSpringParticle1[targetIdx] = firstParticleIdx;
        inputOutputSpringRestLength[targetIdx] = inputOutputSpringRestLength[index];
        atomicAdd(&outputSpringCount, 1);

    }

}
