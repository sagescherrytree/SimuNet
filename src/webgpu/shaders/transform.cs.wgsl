struct Camera {
  viewProj : mat4x4<f32>
};
struct Model {
  model : mat4x4<f32>
};

@binding(0) @group(0) var<uniform> camera : Camera;
@binding(1) @group(0) var<uniform> model : Model;

struct Transformation {
  translate : vec3<f32>,
  rotation : vec3<f32>,
  scale : vec3<f32>,
};

struct VertexIn {
  @location(0) position : vec3<f32>,
  @location(1) normal : vec3<f32>
}

@binding(0) var<storage, read> vertices: vec4<f32>;

fn get_rotation_values(rx: f32, ry: f32, rz: f32)
    -> struct {
        sx: f32, cx: f32,
        sy: f32, cy: f32,
        sz: f32, cz: f32
    }
{
    let sx = sin(rx);
    let cx = cos(rx);

    let sy = sin(ry);
    let cy = cos(ry);

    let sz = sin(rz);
    let cz = cos(rz);

    return struct {
        sx: sx, cx: cx,
        sy: sy, cy: cy,
        sz: sz, cz: cz
    };
}

@compute
fn main(vertexData: VertexIn) {
    let v = vertexData.position;
    let t = params.translation;
    let r = params.rotation;
    let s = params.scale;

    let rot = get_rotation_values(r.x, r.y, r.z);

    var x = v.x * s.x;
    var y = v.y * s.y;
    var z = v.z * s.z;

    var y1 = y * rot.cx - z * rot.sx;
    var z1 = y * rot.sx + z * rot.cx;

    var x2 = x * rot.cy + z1 * rot.sy;
    var z2 = -x * rot.sy + z1 * rot.cy;

    var x3 = x2 * rot.cz - y1 * rot.sz;
    var y3 = x2 * rot.sz + y1 * rot.cz;

    outVertices[index] = vec3f(
        x3 + t.x,
        y3 + t.y,
        z2 + t.z
    );
}