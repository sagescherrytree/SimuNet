struct Camera {
  viewProj : mat4x4<f32>
};
struct Model {
  model : mat4x4<f32>
};

struct Light {
    position: vec3<f32>, // in world space
    ambientIntensity: f32, 
    color: vec3<f32>,
    _padding: f32,
};

@binding(0) @group(0) var<uniform> camera : Camera;
@binding(1) @group(0) var<uniform> model : Model;
@binding(2) @group(0) var<uniform> light : Light;

struct VertexIn {
  @location(0) position : vec3<f32>,
  @location(1) normal : vec3<f32>
}

struct VertexOut {
  @builtin(position) position : vec4<f32>,
  @location(0) worldNormal : vec3<f32>,
  @location(1) worldPosition : vec3<f32>,
};

@vertex
fn vs_main(in: VertexIn) -> VertexOut {
  var out : VertexOut;

  let worldPos = model.model * vec4<f32>(in.position, 1.0);
  out.worldPosition = worldPos.xyz;

  out.position = camera.viewProj * worldPos;
  out.worldNormal = (model.model * vec4<f32>(in.normal, 0.0)).xyz;
  return out;
}

@fragment
fn fs_main(in : VertexOut) -> @location(0) vec4<f32> {
  let N = normalize(in.worldNormal);

  let L = normalize(light.position - in.worldPosition);

  let diffuseFactor = max(dot(N, L), 0.0);
  let diffuseColor = light.color * diffuseFactor;

  let ambientColor = vec3<f32>(1.0, 1.0, 1.0) * light.ambientIntensity;

  let finalColor = ambientColor + diffuseColor;

  return vec4<f32>(finalColor, 1.0);
}