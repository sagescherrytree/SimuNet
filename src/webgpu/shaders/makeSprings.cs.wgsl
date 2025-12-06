
// struct Spring {
//     particleIdx0: u32, // TODO can potentially remove since redundant with other array
//     particleIdx1: u32,
//     restLength: f32,  
//     padding: f32,// TODO does this need padding?
// }

struct VertexIn {
    position : vec4<f32>,
    normal   : vec4<f32>,
};


@group(0) @binding(0)
var<storage, read> inputVertices: array<VertexIn>;
@group(0) @binding(1)
var<storage, read> inputIndices: array<u32>;
// @group(0) @binding(2)
// var<storage, read_write> outputSprings: array<Spring>;
@group(0) @binding(2)
var<storage, read_write> outputSpringFirstParticleIndices: array<u32>;
@group(0) @binding(3)
var<storage, read_write> copySpringFirstParticleIndices: array<u32>;
@group(0) @binding(4)
var<storage, read_write> outputSpringSecondParticleIndices: array<u32>;
@group(0) @binding(5)
var<storage, read_write> outputSpringRestLength: array<f32>;



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
    // outputSprings[index].particleIdx0 = i0;
    // outputSprings[index].particleIdx1 = i1;
    // outputSprings[index].restLength = length(v1.position.xyz - v0.position.xyz);

    // outputSprings[index + 1].particleIdx0 = i1;
    // outputSprings[index + 1].particleIdx1 = i2;
    // outputSprings[index + 1].restLength = length(v2.position.xyz - v1.position.xyz);

    // outputSprings[index + 2].particleIdx0 = i2; 
    // outputSprings[index + 2].particleIdx1 = i0;
    // outputSprings[index + 2].restLength = length(v0.position.xyz - v2.position.xyz);

    outputSpringFirstParticleIndices[index] = i0; 
    copySpringFirstParticleIndices[index] = i0; 
    outputSpringSecondParticleIndices[index] = i1; 
    outputSpringRestLength[index] = length(v1.position.xyz - v0.position.xyz);

    outputSpringFirstParticleIndices[index + 1] = i1; 
    copySpringFirstParticleIndices[index + 1] = i1; 
    outputSpringSecondParticleIndices[index + 1] = i2; 
    outputSpringRestLength[index + 1] = length(v2.position.xyz - v1.position.xyz);

    outputSpringFirstParticleIndices[index + 2] = i2; 
    copySpringFirstParticleIndices[index + 2] = i2; 
    outputSpringSecondParticleIndices[index + 2] = i0; 
    outputSpringRestLength[index + 2] = length(v0.position.xyz - v2.position.xyz);




}
