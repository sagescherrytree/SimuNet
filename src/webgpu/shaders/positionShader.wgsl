struct Camera {
  viewProj : mat4x4<f32>
};
struct Model {
  model : mat4x4<f32>
};

@binding(0) @group(0) var<uniform> camera : Camera;
@binding(1) @group(0) var<uniform> model : Model;

struct VertexIn {
  @location(0) position : vec3<f32>,
  @location(1) normal : vec3<f32>
}
struct VertexOut {
  @builtin(position) position : vec4<f32>,
  @location(0) vColor : vec3<f32>
};

@vertex
fn vs_main(vertexData : VertexIn) -> VertexOut {
  var out : VertexOut;
  out.position = camera.viewProj * (model.model * vec4<f32>(vertexData.position, 1.0));
  out.vColor = (vertexData.position + vec3<f32>(1.0,1.0,1.0)) * 0.5;
  return out;
}

@fragment
fn fs_main(in : VertexOut) -> @location(0) vec4<f32> {
  return vec4<f32>(in.vColor, 1.0);
}