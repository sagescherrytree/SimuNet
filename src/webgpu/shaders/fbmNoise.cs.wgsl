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



fn random3D(  p: vec3f ) -> vec3f {
    return fract(sin(vec3f(dot(p, vec3f(127.1f, 311.7f, 191.999f)),
                                         dot(p, vec3f(269.5f, 183.3f, 773.2f)),
                                         dot(p, vec3f(103.37f, 217.83f, 523.7f)))) * 43758.5453f);
}

fn surflet3D( P: vec3f, gridPoint: vec3f) -> f32
{
    // Compute falloff function by converting linear distance to a polynomial (quintic smootherstep function)
    let dists = abs(P - gridPoint);
    let tX = 1 - 6 * pow(dists.x, 5.0) + 15 * pow(dists.x, 4.0) - 10 * pow(dists.x, 3.0);
    let tY = 1 - 6 * pow(dists.y, 5.0) + 15 * pow(dists.y, 4.0) - 10 * pow(dists.y, 3.0);
    let tZ = 1 - 6 * pow(dists.z, 5.0) + 15 * pow(dists.z, 4.0) - 10 * pow(dists.z, 3.0);

    let gradient = normalize(2.f * random3D(gridPoint) - vec3f(1.f));
    // Get the vector from the grid point to P
    let diff = P - gridPoint;
    // Get the value of our height field by dotting grid->P with our gradient
    let height = dot(diff, gradient);
    // Scale our height field (i.e. reduce it) by our polynomial falloff function
    return height * tX * tY * tZ;
}

fn Perlin3D(uv : vec3f) -> f32
{
    let uvFloored = floor(uv);
    var surfletSum = 0.f;
    for (var dx:f32 = 0; dx <= 1.f; dx += 1.f) {
        for (var dy:f32 = 0; dy <= 1.f; dy += 1.f) {
            for (var dz:f32 = 0; dz <= 1.f; dz += 1.f) {
                surfletSum += surflet3D(uv, uvFloored + vec3f(dx,dy,dz));
            }
        }
    }
    return surfletSum;
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
    let noise = Perlin3D(
        vec3f(
        scaledPos.x + deformation.seed,
        scaledPos.y,
        scaledPos.z)
    );

    // Normalize position vector (CPU version used len normalization)
    let len = max(length(pos), 0.00001);
    let dir = pos / len;

    // Offset direction = normalized position
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
