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

struct VertexIn {
    position : vec4<f32>,
    normal   : vec4<f32>,
};

// Input from NoiseNode.ts
@group(0) @binding(0)
var<storage, read> inputVertices: array<VertexIn>;

@group(0) @binding(1)
var<storage, read_write> outputVertices: array<VertexIn>;

// TODO: Particle buffers...
/**
@group(0) @binding(0)
var<storage, read_write> inputParticles: array<Particle>;
**/

@group(0) @binding(2)
var<uniform> clothParams: ClothSimParams;

// TODO: Pass in time uniform.

fn verletIntegration(p: Particle, deltaTime: f32) -> vec4<f32> {
    if (p.isFixed == 1u) {
        return p.position; // Fixed particle does not move.
    }
    let acceleration = p.force / p.mass;
    let newPosition = p.position + (p.position - p.prevPosition) * (1.0 - clothParams.damping) + acceleration * deltaTime * deltaTime;
    return newPosition;
}   

// Force calculation, Hooke's Law.
// P1, P2: positions of the two particles.
// restLength: rest length of the spring.
// stiffness: spring constant k.
// Apply for every vertex connection.
fn computeSpringForce(p1: vec3<f32>, p2: vec3<f32>, restLength: f32, stiffness: f32) -> vec3<f32> {
    let delta = p2 - p1;
    let dist = length(delta);
    let direction = normalize(delta);
    let forceMagnitude = stiffness * (dist - restLength);
    return forceMagnitude * direction;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    // TODO: Implement cloth sim logic here.
    let index = id.x;
    outputVertices[index].position = inputVertices[index].position;
    outputVertices[index].normal = inputVertices[index].normal; 
}