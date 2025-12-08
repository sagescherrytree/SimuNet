// Pass in index + vertex buffers from nodes w/ recalculated indices (e.g. merge or copyToPoints) to recalc wireframe.
// Recalculate wireframe logic here.

struct Params {
    triangleCount: u32,
};

@group(0) @binding(0) var<storage, read> triangleIndices: array<u32>;

@group(0) @binding(1) var<storage, read_write> wireframeIndices: array<u32>;

@group(0) @binding(2) var<uniform> params: Params;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let index = gid.x;
    if (index >= params.triangleCount) { return; }

    let i0 = triangleIndices[index * 3u + 0u];
    let i1 = triangleIndices[index * 3u + 1u];
    let i2 = triangleIndices[index * 3u + 2u];

    // naive: just write edges consecutively
    wireframeIndices[index * 6u + 0u] = i0;
    wireframeIndices[index * 6u + 1u] = i1;
    wireframeIndices[index * 6u + 2u] = i1;
    wireframeIndices[index * 6u + 3u] = i2;
    wireframeIndices[index * 6u + 4u] = i2;
    wireframeIndices[index * 6u + 5u] = i0;
}