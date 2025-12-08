struct Rigidbody {
  position: vec4<f32>,
  velocity: vec4<f32>,
  mass: f32,
  radius: f32,
  padding1: f32,
  padding2: f32,
}

struct SimParams {
  gravity: vec4<f32>,
  damping: f32,
  restitution: f32,
  padding1: f32,
  padding2: f32,
}

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
var<uniform> params: SimParams;

@group(0) @binding(3)
var<uniform> deltaTime: f32;

// Optional: Add binding for ALL rigidbodies in scene for collision detection
// @group(0) @binding(4)
// var<storage, read> allBodies: array<Rigidbody>;

fn sphereSphereCollision(
  pos1: vec3<f32>, vel1: vec3<f32>, r1: f32, m1: f32,
  pos2: vec3<f32>, vel2: vec3<f32>, r2: f32, m2: f32
) -> vec3<f32> {
  let delta = pos1 - pos2;
  let dist = length(delta);
  let minDist = r1 + r2;
  
  // No collision
  if (dist >= minDist) {
    return vel1;
  }
  
  // Collision response
  let normal = normalize(delta);
  
  // Relative velocity
  let relVel = vel1 - vel2;
  let velAlongNormal = dot(relVel, normal);
  
  // Don't resolve if velocities are separating
  if (velAlongNormal > 0.0) {
    return vel1;
  }
  
  // Calculate impulse
  let e = params.restitution;
  let j = -(1.0 + e) * velAlongNormal / (1.0/m1 + 1.0/m2);
  
  // Apply impulse
  let impulse = j * normal;
  return vel1 + impulse / m1;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
  let idx = id.x;
  if (idx >= arrayLength(&inputBodies)) {
    return;
  }
  
  let body = inputBodies[idx];
  var pos = body.position.xyz;
  var vel = body.velocity.xyz;
  
  // Apply gravity
  vel += params.gravity.xyz * deltaTime;
  
  // Apply damping
  vel *= (1.0 - params.damping);
  
  // TODO: Check collisions with other bodies
  // For now, this only works if you pass all bodies to the shader
  // You'd need to modify the bindgroup to include all rigidbodies in the scene
  //for (var i = 0u; i < arrayLength(&allBodies); i++) {
    //if (i == idx) { continue; }
    
    //let other = allBodies[i];
    //vel = sphereSphereCollision(
      //pos, vel, body.radius, body.mass,
      //other.position.xyz, other.velocity.xyz, other.radius, other.mass
    //);
  //}

  
  // Update position
  pos += vel * deltaTime;
  
  // Floor collision
  if (pos.y - body.radius < 0.0) {
    pos.y = body.radius;
    vel.y = -vel.y * params.restitution;
    vel.x *= 0.95;
    vel.z *= 0.95;
  }
  
  // Write output
  var outBody = body;
  outBody.position = vec4<f32>(pos, 1.0);
  outBody.velocity = vec4<f32>(vel, 0.0);
  
  outputBodies[idx] = outBody;
}