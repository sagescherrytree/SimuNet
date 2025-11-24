struct Transformation {
  translate : vec3<f32>,
  rotation : vec3<f32>,
  scale : vec3<f32>,
};

struct VertexIn {
  position : vec4<f32>,
  normal : vec4<f32>,
}

// Read in from TransformNode.ts compute pipeline.
@group(0) @binding(0) var<storage, read> inputVertices: array<VertexIn>;

@group(0) @binding(1) var<storage, read_write> outputVertices: array<VertexIn>;

@group(0) @binding(2) var<uniform> transform: Transformation;

struct RotVals {
    sx: f32, cx: f32,
    sy: f32, cy: f32,
    sz: f32, cz: f32,
}

const PI: f32 = 3.141592653589793;

fn compute_rot(rx: f32, ry: f32, rz: f32) -> RotVals {
    return RotVals(
        sin(rx), cos(rx),
        sin(ry), cos(ry),
        sin(rz), cos(rz)
    );
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3<u32>) {

    let index = id.x;
    if (index >= arrayLength(&inputVertices)) { return; }

    let curr = inputVertices[index];
    let v = curr.position;

    let t = transform.translate;
    let r = transform.rotation / 180.f * PI;
    let s = transform.scale;

    let rot = compute_rot(r.x, r.y, r.z);

    var x = v.x * s.x;
    var y = v.y * s.y;
    var z = v.z * s.z;

    var y1 = y * rot.cx - z * rot.sx;
    var z1 = y * rot.sx + z * rot.cx;
    var x2 = x * rot.cy + z1 * rot.sy;
    var z2 = -x * rot.sy + z1 * rot.cy;
    var x3 = x2 * rot.cz - y1 * rot.sz;
    var y3 = x2 * rot.sz + y1 * rot.cz;

    // outputVertices[index].position = curr.position;
    // outputVertices[index].position = vec3<f32>(v.x, v.y, v.z);
    outputVertices[index].position = vec4<f32>(x3 + t.x, y3 + t.y, z2 + t.z, v.w);
    outputVertices[index].normal = curr.normal;
}