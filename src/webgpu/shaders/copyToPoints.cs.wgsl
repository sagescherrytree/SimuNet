// TODO: Copy to points logic from multiple inputs.

// Copy to points logic.
// Place all new verts into outputVertexBuffer.
// Indices recalculated and put in outputIndexBuffer.

struct VertexIn {
    position : vec4<f32>,
    normal   : vec4<f32>,
};

// Uniform struct to take in vertexCount information crucial for cpy to pts.
struct Params {
    srcVertexCount : u32,
    srcIndexCount  : u32,
    pointCount     : u32,
    vertexStride   : u32, // bytes (should be 32)
};

@group(0) @binding(0)
var<storage, read> srcVertices : array<VertexIn>;

@group(0) @binding(1)
var<storage, read> srcIndices : array<u32>;

@group(0) @binding(2)
var<storage, read> tgtVertices : array<VertexIn>; // use .pos as point position

@group(0) @binding(3)
var<storage, read_write> outVertices : array<VertexIn>;

@group(0) @binding(4)
var<storage, read_write> outIndices : array<u32>;

@group(0) @binding(5)
var<uniform> params : Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let index = gid.x;
    if (index >= params.pointCount) { return; }

    // Offsets for this point's block:
    let vertBlockOffset : u32 = index * params.srcVertexCount;
    let idxBlockOffset  : u32 = index * params.srcIndexCount;

    // target point position.
    let tp : VertexIn = tgtVertices[index];
    let tpPos : vec3<f32> = tp.position.xyz;

    // Copy all source vertices, translated to point location
    // Note: we are not scaling/rotating here; just translate by point position.
    for (var i = 0u; i < 4u; i += 1) {
        if (i >= params.srcVertexCount) { break; }
        let srcVertex : VertexIn = srcVertices[i];
        var outVertex : VertexIn;
        outVertex.position = vec4<f32>(srcVertex.position.xyz + tpPos, srcVertex.position.w); // translate vertex position
        outVertex.normal = srcVertex.normal; // copy normals unchanged; you may want to rotate them later
        outVertices[vertBlockOffset + i] = outVertex;
    }

    // Copy indices, with vertex offset for this block
    for (var i = 0u; i < 4u; i += 1) {
        if (i >= params.srcIndexCount) { break; }
        let srcIndex : u32 = srcIndices[i];
        // outIndices inside this point's index block
        outIndices[idxBlockOffset + i] = srcIndex + vertBlockOffset;
    }
}