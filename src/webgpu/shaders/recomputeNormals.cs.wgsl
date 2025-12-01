// struct Deformation {
//     strength: f32,
//     scale: f32,
//     seed: f32,
//     modificationType: f32,
// };

struct VertexIn {
    position : vec4<f32>,
    normal   : vec4<f32>,
};


@group(0) @binding(0)
var<storage, read> inputVertices: array<VertexIn>;

@group(0) @binding(1)
var<storage, read_write> outputVertices: array<VertexIn>;
@group(0) @binding(2)
var<storage, read> inputIndices: array<u32>;

// @group(0) @binding(2)
// var<uniform> deformation: Deformation;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {
    let index = id.x * 3;

    // Prevent out-of-bounds reads
    if (index >= arrayLength(&inputIndices)) {
        return;
    }
    let i0 = inputIndices[index];
    let i1 = inputIndices[index + 1];
    let i2 = inputIndices[index + 2];

    let v0 = inputVertices[i0];
    let v1 = inputVertices[i1];
    let v2 = inputVertices[i2];

    let d1 = normalize(v0.position.xyz - v1.position.xyz);
    let d2 = normalize(v2.position.xyz - v1.position.xyz);

    let nrm = normalize(cross(d2,d1));
    // TODO figure out if need to flip? maybe make a uniform that sets that I guess since not sure geom types consistent
    
    outputVertices[i0].position = v0.position;
    outputVertices[i1].position = v1.position;
    outputVertices[i2].position = v2.position;
    
    outputVertices[i0].normal = vec4<f32>(nrm, 0.0);
    outputVertices[i1].normal = vec4<f32>(nrm, 0.0);
    outputVertices[i2].normal = vec4<f32>(nrm, 0.0);
}
