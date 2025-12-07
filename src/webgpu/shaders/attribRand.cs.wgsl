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
    useRandomRotation : u32, 
    pad0: f32,
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

    // Random rotations.
    if (params.useRandomRotation == 1u) {
        let r1 = hash(f32(index) * 17.123);
        let r2 = hash(f32(index) * 37.321);
        let r3 = hash(f32(index) * 71.777);

        let u1 = r1;
        let u2 = r2 * 6.2831853;
        let u3 = r3 * 6.2831853;

        let sqrt1 = sqrt(1.0 - u1);
        let sqrt2 = sqrt(u1);

        a.orient = vec4<f32>(
            sqrt1 * sin(u2),
            sqrt1 * cos(u2),
            sqrt2 * sin(u3),
            sqrt2 * cos(u3)
        );
    } else {
        a.orient = vec4<f32>(0.0, 0.0, 0.0, 1.0);
    }

    attribs[index] = a;
}