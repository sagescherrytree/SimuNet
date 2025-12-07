// TODO: Implement point attribute compute shader.

struct PointAttrib {
    pscale : f32,
    pad0   : f32,
    scale  : vec3<f32>,  // scale.x, scale.y, scale.z
    orient : vec4<f32>,  // quaternion (x y z w)
}

struct AttrRandUnifs {
    scaleMin : f32,
    scaleMax : f32,
    rotX     : f32,
    rotY     : f32,
    rotZ     : f32,
    pad0     : f32,
    pad1     : f32,
    pad2     : f32,
}

@group(0) @binding(0)
var<storage, read_write> attribs : array<PointAttrib>;

@group(0) @binding(1)
var<uniform> params : AttrRandUnifs;

fn hash(n : f32) -> f32 {
    return fract(sin(n) * 43758.5453123);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid : vec3<u32>) {
    let index = gid.x;
    if (index >= arrayLength(&attribs )) {
        return;
    }

    var a = attribs[index];

    let rand = hash(f32(index) * 1.2345);
    let scaleVal = mix(params.scaleMin, params.scaleMax, rand);

    a.pscale = scaleVal;
    a.scale = vec3<f32>(scaleVal);

    let rx = params.rotX;
    let ry = params.rotY;
    let rz = params.rotZ;

    let cx = cos(rx*0.5); let sx = sin(rx*0.5);
    let cy = cos(ry*0.5); let sy = sin(ry*0.5);
    let cz = cos(rz*0.5); let sz = sin(rz*0.5);

    let q = vec4<f32>(
        sx*cy*cz - cx*sy*sz, // x
        cx*sy*cz + sx*cy*sz, // y
        cx*cy*sz - sx*sy*cz, // z
        cx*cy*cz + sx*sy*sz  // w
    );

    a.orient = q;

    attribs[index] = a;
}