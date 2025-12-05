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