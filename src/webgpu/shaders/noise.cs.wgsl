struct Deformation {
    strength: f32,
    scale: f32,
    seed: f32,
    modificationType: f32,
};

struct VertexIn {
    position : vec4<f32>,
    normal   : vec4<f32>,
};

// Input from NoiseNode.ts
@group(0) @binding(0)
var<storage, read> inputVertices: array<VertexIn>;

@group(0) @binding(1)
var<storage, read_write> outputVertices: array<VertexIn>;

@group(0) @binding(2)
var<uniform> deformation: Deformation;

fn simpleNoise(x: f32, y: f32, z: f32) -> f32 {
    // return sin(x * 12.9898 + y * 78.233 + z * 37.719) * 0.5 + 0.5;
    return fract(
                sin(
                        dot(vec3f(x,y,z), vec3f(127.1f, 311.7f, 191.999f))
                    ) * 43758.5453f);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let index = id.x;

    // Prevent out-of-bounds reads
    if (index >= arrayLength(&inputVertices)) {
        return;
    }

    let v = inputVertices[index];

    let pos = v.position.xyz;
    let nrm = v.normal.xyz;

    // Compute noise using same formula
    let scaledPos = pos * deformation.scale;
    let noise = simpleNoise(
        scaledPos.x + deformation.seed,
        scaledPos.y,
        scaledPos.z
    );

    // Normalize position vector (CPU version used len normalization)
    let len = max(length(pos), 0.00001);
    let dir = pos / len;

      if (deformation.modificationType == 0.f) {
        let offset = dir * noise * deformation.strength;
        let newPos = pos + offset;
        // Write back
        outputVertices[index].position = vec4<f32>(newPos, 1.0);

    } else {
        let offset = vec3f(0.f,1.f,0.f) * noise * deformation.strength;
        let newPos = pos + offset;
        outputVertices[index].position = vec4<f32>(newPos, 1.0);
    }
    
    // Either preserve normal or recompute
    outputVertices[index].normal = vec4<f32>(nrm, 0.0);
}
