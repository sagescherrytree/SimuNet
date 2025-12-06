// Passed in from ClothNode.ts as uniform buffer.
struct ClothSimParams {
    stiffness: f32,
    mass: f32,
    damping: f32,
    gravity: f32,
    spacingX: f32,
    spacingZ: f32
}

// Each vert can be represented as a particle.
struct Particle {
    position      : vec4<f32>,  // 16 bytes
    prevPosition  : vec4<f32>,  // 16 bytes
    velocity      : vec4<f32>,  // 16 bytes
    mass          : f32,        // 4 bytes
    isFixed       : u32,        // 4 bytes
    // padding       : f32,        // 4 bytes
    // padding2      : f32,        // 4 bytes
    firstSpringIdx: u32, 
    springCount: u32, 
}

// TODO want to be able to go particle pair to rest length

struct Spring {
    particleIdx0: u32,
    particleIdx1: u32,
    restLength: f32,  
    padding: f32,
}


struct VertexOut {
    position : vec4<f32>,
    normal   : vec4<f32>,
};

// Input from NoiseNode.ts
@group(0) @binding(0)
var<storage, read> inputParticles: array<Particle>; 
// TODO should probably make convert to non-atomic values before this so don't need to make read_write (atomic always needs to be read_write) but not sure it matters (probably faster if just read)
// AH: need to make not atomic to make outputParticles constructible

@group(0) @binding(1)
var<storage, read_write> outputParticles: array<Particle>;

@group(0) @binding(2)
var<storage, read_write> outputVertices: array<VertexOut>;

@group(0) @binding(3)
var<uniform> clothParams: ClothSimParams;

@group(0) @binding(4)
var<uniform> deltaTime: f32;

@group(0) @binding(5)
var<storage, read> inputSprings: array<Spring>;

fn getParticleIndex(x: u32, y: u32, width: u32) -> u32 {
    return y * width + x;
}

fn getGridCoords(index: u32, width: u32) -> vec2<u32> {
    return vec2<u32>(index % width, index / width);
}

// fn verletIntegration(p: Particle, deltaTime: f32) -> vec4<f32> {
//     if (p.isFixed == 1u) {
//         return p.position; // Fixed particle does not move.
//     }
//     let acceleration = p.force / p.mass;
//     let newPosition = p.position + (p.position - p.prevPosition) * (1.0 - clothParams.damping) + acceleration * deltaTime * deltaTime;
//     return newPosition;
// }   

// Force calculation, Hooke's Law.
// P1, P2: positions of the two particles.
// restLength: rest length of the spring.
// stiffness: spring constant k.
// Apply for every vertex connection.
fn computeSpringForce(p1: vec3<f32>, p2: vec3<f32>, restLength: f32, stiffness: f32) -> vec3<f32> {
    let delta = p2 - p1;
    let dist = length(delta);

    if (dist < 0.0001) {
        return vec3<f32>(0.0);
    }

    let direction = normalize(delta);
    let forceMagnitude = stiffness * (dist - restLength);
    return forceMagnitude * direction;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    // TODO: Implement cloth sim logic here.
    let index = id.x;
    let totalParticles = arrayLength(&inputParticles);

    if (index >= totalParticles) {
        return;
    }

    let p = &inputParticles[index];

    // fixed particles no movey movey
    if ((*p).isFixed == 1u) {
        outputParticles[index] = *p;
        outputVertices[index].position = (*p).position;
        outputVertices[index].normal = vec4<f32>(0.0, 1.0, 0.0, 0.0);
        return;
    }

    var force = vec3<f32>(0.0, -clothParams.gravity * (*p).mass, 0.0); // Gravity!
    // var force = vec3<f32>(0.0, 0.0, 0.0);

    // TODO once GPU-side setup is done:
    for (var i = (*p).firstSpringIdx; i < (*p).firstSpringIdx + (*p).springCount; i++) {
        let otherParticleIdx = inputSprings[i].particleIdx1;
        let restLength = inputSprings[i].restLength;

        let neighbor = &inputParticles[otherParticleIdx];

        let springForce = computeSpringForce(
            (*p).position.xyz,
            (*neighbor).position.xyz,
            restLength,
            clothParams.stiffness
        );

        force += springForce;
    }
    
    // TODO thinking on collisions
    //  working w/ particles as spheres (w/ some fixed radius for all of them), does it make more sense to test against set of triangles or figure out how to convert volume of shape into a set of particles (like not just points at vertices, space-filling)
    //  I think latter is probably a generally better approach but former is simpler implementation-wise?
    //   not very efficient but:
    //   make the node take in a second input for the geometry we want to collide against
    //   in this, have a loop that goes over all the triangles in that and checks for sphere-triangle intersection
    //    then I guess if it does intersect apply force (along the normal vector of the triangle? in sphere-triangle intersect finding nearest point to sphere center, so push along vector from that point to sphere center)
    
    // Verlet calcuation LOL
    let acceleration = force / clothParams.mass;
    let dampingFactor = 1.0 - clothParams.damping;
    let position = (*p).position.xyz + ((*p).position.xyz - (*p).prevPosition.xyz) * dampingFactor + acceleration * deltaTime * deltaTime;
    
    var finalPos = position;

    if (finalPos.y < 0.0) {
        finalPos.y = 0.0;
    }

    var outParticle = (*p);
    outParticle.prevPosition = (*p).position;
    outParticle.position = vec4<f32>(finalPos, 1.0);

    outputParticles[index] = outParticle;

    var normal = vec3<f32>(0.0, 1.0, 0.0);
    // TODO maybe can just not calculate normal here and make have to use the recalculate normal node? or can use the particles pointed to by springs to do same as before
    
    // if (x > 0u && x < gridSize.x - 1u && y > 0u && y < gridSize.y - 1u) {
    //     let right = inputParticles[getParticleIndex(x + 1u, y, gridSize.x)].position.xyz;
    //     let left = inputParticles[getParticleIndex(x - 1u, y, gridSize.x)].position.xyz;
    //     let up = inputParticles[getParticleIndex(x, y - 1u, gridSize.x)].position.xyz;
    //     let down = inputParticles[getParticleIndex(x, y + 1u, gridSize.x)].position.xyz;
        
    //     let tangent1 = normalize(right - left);
    //     let tangent2 = normalize(down - up);
    //     normal = normalize(cross(tangent1, tangent2));
    // }
    
    outputVertices[index].position = vec4<f32>(finalPos, 1.0);
    //outputVertices[index].position = p.position;
    outputVertices[index].normal = vec4<f32>(normal, 0.0);
} 