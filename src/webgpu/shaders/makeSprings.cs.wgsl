
struct Spring {
    particleIdx0: u32,
    particleIdx1: u32,
    restLength: f32,  
}

struct VertexIn {
    position : vec4<f32>,
    normal   : vec4<f32>,
};


@group(0) @binding(0)
var<storage, read> inputVertices: array<VertexIn>;
@group(0) @binding(1)
var<storage, read> inputIndices: array<u32>;
@group(0) @binding(2)
var<storage, write> outputSprings: array<Spring>;



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

    // TODO figure out how to handle getting both directions of edges of plane to have springs
    outputSprings[i0].particleIdx0 = i0;
    outputSprings[i0].particleIdx1 = i1;
    outputSprings[i0].restLength = (v1.position.xyz - v0.position.xyz).length();

    outputSprings[i1].particleIdx0 = i1;
    outputSprings[i1].particleIdx1 = i2;
    outputSprings[i1].restLength = (v2.position.xyz - v1.position.xyz).length();

    outputSprings[i2].particleIdx0 = i2; 
    outputSprings[i2].particleIdx1 = i0;
    outputSprings[i1].restLength = (v0.position.xyz - v2.position.xyz).length();

}
