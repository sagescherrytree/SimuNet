// Copy to Points - Final version with explicit scalar layout

struct VertexIn {
    position : vec4<f32>,
    normal   : vec4<f32>,
};

struct Params {
    srcVertexCount : u32,
    srcIndexCount  : u32,
    pointCount     : u32,
    vertexStride   : u32,
};

// Use individual floats - matches TypeScript's 9-float layout exactly
struct PointAttrib {
    pscale   : f32,  // [0]
    pad0     : f32,  // [1]
    scale_x  : f32,  // [2]
    scale_y  : f32,  // [3]
    scale_z  : f32,  // [4]
    orient_x : f32,  // [5]
    orient_y : f32,  // [6]
    orient_z : f32,  // [7]
    orient_w : f32,  // [8]
}

@group(0) @binding(0)
var<storage, read> srcVertices : array<VertexIn>;

@group(0) @binding(1)
var<storage, read> srcIndices : array<u32>;

@group(0) @binding(2)
var<storage, read> tgtVertices : array<VertexIn>;

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
    if (index >= params.pointCount) { 
        return; 
    }

    let vertBlockOffset = index * params.srcVertexCount;
    let idxBlockOffset = index * params.srcIndexCount;

    let tp = tgtVertices[index];
    let tpPos = tp.position.xyz;
    let attrib = pointAttribs[index];
    
    // Reconstruct vectors from individual floats (no alignment issues!)
    let scale = vec3<f32>(attrib.scale_x, attrib.scale_y, attrib.scale_z);
    let orient = vec4<f32>(attrib.orient_x, attrib.orient_y, attrib.orient_z, attrib.orient_w);
    
    // Combined scale
    let s = attrib.pscale * scale;

    // Transform and copy all source vertices for this point
    for (var i = 0u; i < params.srcVertexCount; i++) {
        let srcVertex = srcVertices[i];
        let outIdx = vertBlockOffset + i;
        
        // Apply transformations: scale -> rotate -> translate
        let basePos = srcVertex.position.xyz * s;
        let rotated = quat_rotate(orient, basePos);
        
        outVertices[outIdx].position = vec4<f32>(rotated + tpPos, srcVertex.position.w);
        outVertices[outIdx].normal = vec4<f32>(quat_rotate(orient, srcVertex.normal.xyz), 0.0);
    }

    // Copy indices with offset
    for (var i = 0u; i < params.srcIndexCount; i++) {
        let srcIdx = srcIndices[i];
        let outIdx = idxBlockOffset + i;
        outIndices[outIdx] = srcIdx + vertBlockOffset;
    }
}