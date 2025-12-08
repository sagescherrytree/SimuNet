struct VertexIn {
    position : vec4<f32>,
    normal   : vec4<f32>,
};

struct Params {
    vertexCount1 : u32,
    indexCount1  : u32,
    vertexCount2 : u32,
    indexCount2  : u32,
};

@group(0) @binding(0)
var<storage, read> vertexIn1 : array<VertexIn>; // Vertices of input 1.

@group(0) @binding(1)
var<storage, read> indexIn1 : array<u32>; // Indices of input 1.

@group(0) @binding(2)
var<storage, read> vertexIn2 : array<VertexIn>; // Vertices of input 2.

@group(0) @binding(3)
var<storage, read> indexIn2 : array<u32>; // Indices of input 2.

@group(0) @binding(4)
var<storage, read_write> outVertices : array<VertexIn>;

@group(0) @binding(5)
var<storage, read_write> outIndices : array<u32>;

@group(0) @binding(6)
var<uniform> params : Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let index = gid.x;

    let totalVerts = params.vertexCount1 + params.vertexCount2;
    let totalIndices = params.indexCount1 + params.indexCount2;

    // Vertex merge.
    if (index < totalVerts) {
        if (index < params.vertexCount1) {
            // vertices from input 1.
            outVertices[index] = vertexIn1[index];
        } else {
            // vertices from input 2.
            let j = index - params.vertexCount1;
            if (j < params.vertexCount2) {
                outVertices[index] = vertexIn2[j];
            }
        }
        return;
    }

    // Index merge.
    let i = index - totalVerts;
    if (i < params.indexCount1) {
        outIndices[i] = indexIn1[i];
        return;
    }

    let j = i - params.vertexCount1;

    if (j < params.indexCount2) {
        outIndices[i] = indexIn2[j] + params.vertexCount1;
    }
}