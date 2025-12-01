// TODO:: Implement cloth simulation code here.

/**
    Joanna's notes.
    Framework Setup
    Using the CIS5600 Mesh Editor Framework with Polar Camera and OpenGL-based renderer
    Particle System
    Each particle has attributes: position, velocity, force, mass, isFixed.
    Grid layout initialized with particles connected by springs.
    Spring System
    Three types of springs: Structural, shear, and bend springs.
    Force calculation using Hooke’s Law:
    F = k * (distance – restLength) * direction 
    k: Spring stiffness
    distance: Current length
    restLength: Original spring length
    Numerical Integration
    Transitioned from Euler integration to Verlet integration for improved numerical stability. Link
    Implementation included:
    Previous position tracking to handle motion.
    Applying forces via acceleration-based updates.
    Collision Handling
    Implemented floor collision detection to prevent particles from falling indefinitely.
    Improved response by adjusting velocity post-collision.
    Rendering and Interaction
    Visualization with particle rendering, spring rendering and triangle-based mesh rendering.
    Implemented mouse-based interaction to allow dragging of individual particles.
    Research Notes
    Physically Based Animation Techniques
    Mass-Spring Systems: Used for both cloth and soft body simulations.
    Implicit vs. Explicit Integration: Explored stability trade-offs.
    Collision Detection: Investigated methods for handling self-collisions and external object interactions.
    SPH Methods for fluid simulation (density estimation, pressure gradients, viscosity).
    Spatial Grids: Used for fast neighbor lookups.
    Numerical Methods
    Implemented Verlet integration to ensure smoother motion.
    Adjusted damping coefficients to prevent perpetual motion.
    Graphics Pipeline
    Optimized VBO updates to handle real-time deformation.
    Implemented OpenGL triangle-based rendering and buffer population.
    Research Notes
    Physically Based Animation Techniques
    Mass-Spring Systems: Used for both cloth and soft body simulations.
    Implicit vs. Explicit Integration: Explored stability trade-offs.
    Collision Detection: Investigated methods for handling self-collisions and external object interactions.
    SPH Methods for fluid simulation (density estimation, pressure gradients, viscosity).
    Spatial Grids: Used for fast neighbor lookups.
    Numerical Methods
    Implemented Verlet integration to ensure smoother motion.
    Adjusted damping coefficients to prevent perpetual motion.
    Graphics Pipeline
    Optimized VBO updates to handle real-time deformation.
    Implemented OpenGL triangle-based rendering and buffer population.
**/

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
    padding       : f32,        // 4 bytes
    padding2      : f32,        // 4 bytes
}

struct VertexOut {
    position : vec4<f32>,
    normal   : vec4<f32>,
};

// Input from NoiseNode.ts
@group(0) @binding(0)
var<storage, read> inputParticles: array<Particle>;

@group(0) @binding(1)
var<storage, read_write> outputParticles: array<Particle>;

@group(0) @binding(2)
var<storage, read_write> outputVertices: array<VertexOut>;

@group(0) @binding(3)
var<uniform> clothParams: ClothSimParams;

@group(0) @binding(4)
var<uniform> deltaTime: f32;

@group(0) @binding(5)
var<uniform> gridSize: vec2<u32>; // width, height of the cloth grid


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

    let p = inputParticles[index];

    // fixed particles no movey movey
    if (p.isFixed == 1u) {
        outputParticles[index] = p;
        outputVertices[index].position = p.position;
        outputVertices[index].normal = vec4<f32>(0.0, 1.0, 0.0, 0.0);
        return;
    }

    var force = vec3<f32>(0.0, -clothParams.gravity * p.mass, 0.0); // Gravity!
    // var force = vec3<f32>(0.0, 0.0, 0.0);

    let coords = getGridCoords(index, gridSize.x);
    let x = coords.x;
    let y = coords.y;

    // left, right, up, down
    let neighbors = array<vec2<i32>, 4>(
        vec2<i32>(-1, 0), vec2<i32>(1, 0),
        vec2<i32>(0, -1), vec2<i32>(0, 1)
    );


    var restLength = 0.125;
    
    for (var i = 0u; i < 4u; i+=1) {
        let nx = i32(x) + neighbors[i].x;
        let ny = i32(y) + neighbors[i].y;

        if (neighbors[i].x != 0) {
            restLength = clothParams.spacingX;
        } else {
            restLength = clothParams.spacingZ;
        }
        
        if (nx >= 0 && nx < i32(gridSize.x) && ny >= 0 && ny < i32(gridSize.y)) {
            let neighborIdx = getParticleIndex(u32(nx), u32(ny), gridSize.x);
            let neighbor = inputParticles[neighborIdx];

            let springForce = computeSpringForce(
                p.position.xyz,
                neighbor.position.xyz,
                restLength,
                clothParams.stiffness
            );

            force += springForce;
        }
    }

    // diagonal neighbors
    let diagonals = array<vec2<i32>, 4> (
        vec2<i32>(-1, -1),
        vec2<i32>(1, -1),
        vec2<i32>(-1, 1),
        vec2<i32>(1, 1)
    );

    let diagRestLength = sqrt(clothParams.spacingX * clothParams.spacingX + clothParams.spacingZ * clothParams.spacingZ);

    for (var i = 0u; i < 4u; i += 1) {
        let nx = i32(x) + diagonals[i].x;
        let ny = i32(y) + diagonals[i].y;

        if (nx >= 0 && nx < i32(gridSize.x) && ny >= 0 && ny < i32(gridSize.y)) {
            let neighborIdx = getParticleIndex(u32(nx), u32(ny), gridSize.x);
            let neighbor = inputParticles[neighborIdx];
            
            let springForce = computeSpringForce(
                p.position.xyz,
                neighbor.position.xyz,
                diagRestLength,
                clothParams.stiffness * 0.5 // these springs are weaker
            );

            force += springForce;
        }
    }
    
    // Verlet calcuation LOL
    let acceleration = force / clothParams.mass;
    let dampingFactor = 1.0 - clothParams.damping;
    let position = p.position.xyz + (p.position.xyz - p.prevPosition.xyz) * dampingFactor + acceleration * deltaTime * deltaTime;
    
    var finalPos = position;

    if (finalPos.y < 0.0) {
        finalPos.y = 0.0;
    }

    var outParticle = p;
    outParticle.prevPosition = p.position;
    outParticle.position = vec4<f32>(finalPos, 1.0);

    outputParticles[index] = outParticle;

    var normal = vec3<f32>(0.0, 1.0, 0.0);
    
    if (x > 0u && x < gridSize.x - 1u && y > 0u && y < gridSize.y - 1u) {
        let right = inputParticles[getParticleIndex(x + 1u, y, gridSize.x)].position.xyz;
        let left = inputParticles[getParticleIndex(x - 1u, y, gridSize.x)].position.xyz;
        let up = inputParticles[getParticleIndex(x, y - 1u, gridSize.x)].position.xyz;
        let down = inputParticles[getParticleIndex(x, y + 1u, gridSize.x)].position.xyz;
        
        let tangent1 = normalize(right - left);
        let tangent2 = normalize(down - up);
        normal = normalize(cross(tangent1, tangent2));
    }
    
    outputVertices[index].position = vec4<f32>(finalPos, 1.0);
    //outputVertices[index].position = p.position;
    outputVertices[index].normal = vec4<f32>(normal, 0.0);
} 