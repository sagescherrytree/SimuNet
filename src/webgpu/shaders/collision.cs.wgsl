// TODO: Logic for collision detection of rigidbodies.

// Struct body for item that will be collidable.
struct Rigidbody {
    position: vec4<f32>,
    velocity: vec4<f32>,
    mass: f32,
    radius: f32,
    padding1: f32, // align to 16 bytes
    padding2: f32,
};

// Collision detection based on triangles.
struct Triangle {
    v0: vec4<f32>;
    v1: vec4<f32>;
    v2: vec4<f32>;
};

@group(0) @binding(0)
var<storage, read_write> bodies: array<Rigidbody>;

@group(0) @binding(1)
var<storage, read> triangles: array<Triangle>;

// TEMP: Sphere/triangle collision.
fn sphereTriangleCollision(pos: vec4<f32>, radius: f32, tri: Triangle) -> vec4<f32> {
    // Find closest point on triangle to sphere center.
    let edge0 = tri.v1 - tri.v0;
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
        return normalize(dir) * (radius - dist); 
    }

    return vec3<f32>(0.0); 
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let index = id.x;
    if (index >= arrayLength(&bodies)) { return; }

    var body = bodies[index];

    var correction = vec4<f32>(0.0);

    // Loop over all triangles.
    for (var t = 0u; t < arrayLength(&triangles); t++) {
        correction += sphereTriangleCollision(body.position, body.radius, triangles[t]);
    }

    // Apply positional correction.
    body.position += correction;

    bodies[index] = body;
}
