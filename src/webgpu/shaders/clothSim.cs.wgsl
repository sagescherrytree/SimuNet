// Passed in from ClothNode.ts as uniform buffer.
struct ClothSimParams {
    stiffness: f32,
    mass: f32,
    damping: f32,
    gravity: f32,
    spacingX: f32,
    spacingZ: f32,
    pinningMode: f32,
    particleRadius: f32, // TODO could have set per particle but probably no reason to
    hasCollisionGeometry: u32,
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

@group(0) @binding(6)
var<storage, read> inputCollisionVertices: array<VertexOut>;
@group(0) @binding(7)
var<storage, read> inputCollisionIndices: array<u32>;


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
    let forceMagnitude = stiffness * (dist - restLength) / dist; // I think this is meant to be proportional? not sure. maybe change back
    // TODO should there be dampening here?
    return forceMagnitude * direction;
}

// Collision detection based on triangles.
// TODO does making this into a struct run slower? will keep as is for now but maybe should be like passed in as 3 pointers?
struct Triangle {
    v0: vec3<f32>,
    v1: vec3<f32>,
    v2: vec3<f32>,
}
fn sphereTriangleCollision(pos: vec3<f32>, radius: f32, tri: Triangle) -> vec3<f32> {
    // Find closest point on triangle to sphere center.
    let edge0 = tri.v1 - tri.v0; // TODO should this be doing .xyz? does that matter performance-wise? like is it one less subtraction operation or is it the same or worse
    let edge1 = tri.v2 - tri.v0;
    let v0ToPoint = pos - tri.v0;

    let dot00 = dot(edge0, edge0);
    let dot01 = dot(edge0, edge1);
    let dot11 = dot(edge1, edge1);
    let dot02 = dot(edge0, v0ToPoint);
    let dot12 = dot(edge1, v0ToPoint);

    let denom = dot00 * dot11 - dot01 * dot01;
    var u = (dot11 * dot02 - dot01 * dot12) / denom;
    var v = (dot00 * dot12 - dot01 * dot02) / denom;

    // Clamp barycentric coords.
    u = clamp(u, 0.0, 1.0);
    v = clamp(v, 0.0, 1.0);
    if (u + v > 1.0) {
        let t = u + v - 1.0;
        u -= t * (u / (u + v));
        v -= t * (v / (u + v));
    }

    let closest = tri.v0 + edge0 * u + edge1 * v;
    let dir = pos - closest;
    let dist = length(dir);

    if (dist < radius && dist > 0.0001) {
        // return normalize(dir) ; 
        return normalize(dir) * (radius - dist); 
    }

    return vec3<f32>(0.0);
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
    
    // TODO iterate through geometry to collide with
    // TODO thinking on collisions
    //  working w/ particles as spheres (w/ some fixed radius for all of them), does it make more sense to test against set of triangles or figure out how to convert volume of shape into a set of particles (like not just points at vertices, space-filling)
    //  I think latter is probably a generally better approach but former is simpler implementation-wise?
    //   not very efficient but:
    //   make the node take in a second input for the geometry we want to collide against
    //   in this, have a loop that goes over all the triangles in that and checks for sphere-triangle intersection
    //    then I guess if it does intersect apply force (along the normal vector of the triangle? in sphere-triangle intersect finding nearest point to sphere center, so push along vector from that point to sphere center)
    
    var offsetPos = (*p).position.xyz;
    if (clothParams.hasCollisionGeometry == 1) {
        for (var i = 0u; i < arrayLength(&inputCollisionIndices); i += 3u) {
            // test collision per triangle
            let i0 = inputCollisionIndices[i];
            let i1 = inputCollisionIndices[i+1];
            let i2 = inputCollisionIndices[i+2];
            let v0 = &(inputCollisionVertices[i0]);
            let v1 = &(inputCollisionVertices[i1]);
            let v2 = &(inputCollisionVertices[i2]);
            // let collisionVector = sphereTriangleCollision((*p).position, clothParams.particleRadius, Triangle((*v0).position, (*v1).position, (*v2).position));
            let collisionVector = sphereTriangleCollision(
                // (*p).position.xyz, 
                offsetPos,
                clothParams.particleRadius, 
                Triangle(
                    (*v0).position.xyz, 
                    (*v1).position.xyz, 
                    (*v2).position.xyz
                )
            );

            // if (any(collisionVector != vec4<f32>(0.0))) {
            if (length(collisionVector) > 0.0) {
                // force += vec3f(0.0, 10.0, 0.0);
                // force += collisionVector.xyz * 500.0;
                offsetPos += collisionVector;
                // TODO not sure if it makes more sense to apply as a force or just move it immediately?
            }

            // TODO friction? want if colliding to have a force in opposite direction of current velocity?

            // Placeholder code TODO delete
            // let d1 = (*p).position.xyz - (*v0).position.xyz;
            // let d2 = (*p).position.xyz - (*v1).position.xyz;
            // let d3 = (*p).position.xyz - (*v2).position.xyz;
            // if (min(length(d1), min(length(d2), length(d3))) <= clothParams.particleRadius) {
            //     force += vec3f(0.0, 100.0, 0.0);
            // }
            // force += vec3f(0.0, 10000.0, 0.0);
            // position.y += 10.0;
        }
    }


    // let dampingFactor = 1.0 - clothParams.damping;
    let dampingFactor = clothParams.damping;
    let vel = (offsetPos - (*p).prevPosition.xyz) / deltaTime;
    // let vel = ((*p).position.xyz - (*p).prevPosition.xyz) / deltaTime;
    let linearDampingForce = -vel * dampingFactor;
    force += linearDampingForce;
    // Verlet calcuation LOL
    let acceleration = force / clothParams.mass;
    // let position = (*p).position.xyz + prevVel + acceleration * deltaTime * deltaTime;
    let position = 2 * offsetPos - (*p).prevPosition.xyz + acceleration * deltaTime * deltaTime;
    // let position = 2 * (*p).position.xyz - (*p).prevPosition.xyz + acceleration * deltaTime * deltaTime;
    
    var finalPos = position;
    // var prevPos = (*p).position.xyz;
    var prevPos = vec4<f32>(offsetPos, 1.0);

    if (finalPos.y < 0.0) {
        finalPos.y = 0.0;
        let prevVel = (offsetPos - (*p).prevPosition.xyz);
        // let prevVel = ((*p).position.xyz - (*p).prevPosition.xyz);
        let dampedVel = prevVel * 0.3; // Friction coefficient!
        // TODO integrate ground friction in as a force I think
        prevPos = vec4<f32>(finalPos - dampedVel, 1.0);
    }

    var outParticle = (*p);
    outParticle.prevPosition = prevPos;
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