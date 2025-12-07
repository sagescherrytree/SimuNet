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

// For point attributes.
struct PointAttrib {
    pscale : f32,
    pad0   : f32,
    scale  : vec3<f32>,  // scale.x, scale.y, scale.z
    orient : vec4<f32>,  // quaternion (x y z w)
}

@group(0) @binding(0)
var<storage, read> srcVertices : array<VertexIn>;

@group(0) @binding(1)
var<storage, read> srcIndices : array<u32>;

@group(0) @binding(2)
var<storage, read> tgtVertices : array<VertexIn>; // use .pos as point position

@group(0) @binding(3)
var<storage, read> pointAttribs : array<PointAttrib>;

@group(0) @binding(4)
var<storage, read_write> outVertices : array<VertexIn>;

@group(0) @binding(5)
var<storage, read_write> outIndices : array<u32>;

@group(0) @binding(6)
var<uniform> params : Params;

fn quat_mul(q : vec4<f32>, r : vec4<f32>) -> vec4<f32> {
    return vec4<f32>(
        q.w*r.x + q.x*r.w + q.y*r.z - q.z*r.y,
        q.w*r.y - q.x*r.z + q.y*r.w + q.z*r.x,
        q.w*r.z + q.x*r.y - q.y*r.x + q.z*r.w,
        q.w*r.w - q.x*r.x - q.y*r.y - q.z*r.z
    );
}

fn quat_rotate(q : vec4<f32>, v : vec3<f32>) -> vec3<f32> {
    let qv = vec4<f32>(v, 0.0);
    let qi = vec4<f32>(-q.xyz, q.w);
    let result = quat_mul(quat_mul(q, qv), qi);
    return result.xyz;
}

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
    // Get point attrib.
    let pointAttrib = pointAttribs[index];

    // Scale factor.
    let s = pointAttrib.pscale * pointAttrib.scale;

    // Copy all source vertices, translated to point location
    // Note: we are not scaling/rotating here; just translate by point position.
    for (var i = 0u; i < params.srcVertexCount; i += 1) {
        if (i >= params.srcVertexCount) { break; }
        let srcVertex = srcVertices[i];
        var outVertex : VertexIn;

        let basePos = srcVertex.position.xyz * s;
        let rotated = quat_rotate(pointAttrib.orient, basePos);

        outVertex.position = vec4<f32>(rotated + tpPos, srcVertex.position.w); // translate vertex position
        outVertex.normal =  vec4<f32>( quat_rotate(pointAttrib.orient, srcVertex.normal.xyz), 0.0 );
        outVertices[vertBlockOffset + i] = outVertex;
    }

    // Copy indices, with vertex offset for this block
    for (var i = 0u; i < params.srcIndexCount; i += 1) {
        if (i >= params.srcIndexCount) { break; }
        let srcIndex : u32 = srcIndices[i];
        // outIndices inside this point's index block
        outIndices[idxBlockOffset + i] = srcIndex + vertBlockOffset;
    }
}