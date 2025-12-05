// TODO: Logic for simulation of rigid bodies.

struct Rigidbody {
    position: vec4<f32>,
    velocity: vec4<f32>,
    mass: f32,
    radius: f32,
    padding1: f32, // align to 16 bytes
    padding2: f32,
};

struct SimParams {
    gravity: vec4<f32>,
    damping: f32,
    dt: f32,
};

//  TODO rigidbodies also need to account for rotation; as is does it make more sense to just do collision in same compute shader (both working on same input)? also note like collisions should be applying a force so should affect velocity and such
//   also thinking perhaps rigidbodies then need to do triangle/triangle intersection for finding collisions, then use that to get force vectors, then apply all of those force vectors to center of mass as if a particle. Not totally sure how to work the torque into that for rotating (like torque applied based on the input force being less aligned towards center IIRC?)
//      ^if doing that then should probably have: separate collision compute shader but the input is the array of indices (-> triangles) in the rigidbody's mesh, then do iterating over the other triangles to do collision; output some sort of accumulated force and torque but not sure how to set up exactly.
//        So then this one would be taking in the rigidbody and applying that force/torque to change velocity/angular velocity and updating position/rotation
//        Then I guess would transform triangle positions basically as in the transform node shader
// Rigidbody sim compute shader reads in Rigidbody buffer and output Rigidbody buffer.
// Perhaps we can consider writing another compute shader to put output Rigidbody buffer back into output verts?
@group(0) @binding(0)
var<storage, read> inputBodies: array<Rigidbody>;

@group(0) @binding(1)
var<storage, read_write> outputBodies: array<Rigidbody>;

@group(0) @binding(2)
var<uniform> simParams: SimParams;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let index = id.x;
    if (index >= arrayLength(&inputBodies)) { return; }

    var body = inputBodies[index];

    let force = simParams.gravity * body.mass;

    body.velocity += (force / body.mass) * simParams.dt;

    body.velocity *= 1.0 - simParams.damping;

    body.position += body.velocity * simParams.dt;

    outputBodies[index] = body;
}