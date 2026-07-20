/** Fullscreen triangle + liquid glass fragment (procedural backdrop + SDF refraction). */
export const VERTEX_WGSL = /* wgsl */ `
struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VSOut {
  var p = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f( 3.0, -1.0),
    vec2f(-1.0,  3.0),
  );
  var out: VSOut;
  out.pos = vec4f(p[vi], 0.0, 1.0);
  out.uv = p[vi] * 0.5 + 0.5;
  out.uv.y = 1.0 - out.uv.y;
  return out;
}
`

export const FRAGMENT_WGSL = /* wgsl */ `
struct Uniforms {
  resolution: vec2f,
  time: f32,
  radius: f32,
  bezel: f32,
  thickness: f32,
  blur: f32,
  chroma: f32,
  tint: vec4f,
  light: vec2f,
  _pad: vec2f,
}

@group(0) @binding(0) var<uniform> u: Uniforms;

fn hash21(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn noise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u2 = f * f * (3.0 - 2.0 * f);
  let a = hash21(i);
  let b = hash21(i + vec2f(1.0, 0.0));
  let c = hash21(i + vec2f(0.0, 1.0));
  let d = hash21(i + vec2f(1.0, 1.0));
  return mix(mix(a, b, u2.x), mix(c, d, u2.x), u2.y);
}

fn fbm(p: vec2f) -> f32 {
  var v = 0.0;
  var a = 0.5;
  var x = p;
  for (var i = 0; i < 5; i++) {
    v += a * noise(x);
    x = x * 2.02 + 17.0;
    a *= 0.5;
  }
  return v;
}

fn backdrop(uv: vec2f, t: f32) -> vec3f {
  let p = uv * vec2f(1.4, 1.0);
  let n1 = fbm(p * 2.2 + vec2f(t * 0.07, -t * 0.05));
  let n2 = fbm(p * 3.1 + vec2f(-t * 0.04, t * 0.06) + 8.0);
  let blobA = exp(-length(uv - vec2f(0.22 + 0.04 * sin(t * 0.6), 0.28)) * 4.2);
  let blobB = exp(-length(uv - vec2f(0.78, 0.55 + 0.05 * cos(t * 0.5))) * 3.6);
  let blobC = exp(-length(uv - vec2f(0.45, 0.82)) * 3.2);

  var col = vec3f(0.90, 0.91, 0.94);
  col = mix(col, vec3f(0.35, 0.62, 1.00), blobA * 0.85);
  col = mix(col, vec3f(0.45, 0.38, 0.92), blobB * 0.70);
  col = mix(col, vec3f(1.00, 0.62, 0.28), blobC * 0.55);
  col += (n1 - 0.5) * 0.08;
  col = mix(col, col * vec3f(1.05, 1.02, 1.08), n2 * 0.35);
  return clamp(col, vec3f(0.0), vec3f(1.0));
}

fn sdRoundRect(p: vec2f, b: vec2f, r: f32) -> f32 {
  let q = abs(p) - b + r;
  return min(max(q.x, q.y), 0.0) + length(max(q, vec2f(0.0))) - r;
}

fn sampleBg(uv: vec2f, t: f32) -> vec3f {
  let e = 1.0 / max(u.resolution.x, 1.0);
  let blurPx = clamp(u.blur, 0.0, 8.0);
  if (blurPx < 0.2) {
    return backdrop(uv, t);
  }
  var acc = vec3f(0.0);
  var wsum = 0.0;
  let taps = 9;
  for (var i = 0; i < taps; i++) {
    let a = f32(i) * 2.399963;
    let r = sqrt(f32(i) + 0.5) / sqrt(f32(taps));
    let o = vec2f(cos(a), sin(a)) * r * blurPx * e * 18.0;
    let w = 1.0 - r * 0.35;
    acc += backdrop(uv + o, t) * w;
    wsum += w;
  }
  return acc / wsum;
}

@fragment
fn fs(@location(0) uv: vec2f) -> @location(0) vec4f {
  let res = max(u.resolution, vec2f(1.0));
  let px = uv * res;
  let halfSize = res * 0.5;
  let center = halfSize;
  let p = px - center;

  let maxR = min(halfSize.x, halfSize.y);
  let radius = clamp(u.radius, 0.0, maxR);
  let box = halfSize - vec2f(1.5);
  let d = sdRoundRect(p, box, radius);

  // Outside glass: show soft procedural field (shell fills the panel)
  let outside = smoothstep(1.5, -0.5, d);
  if (outside < 0.001) {
    return vec4f(backdrop(uv, u.time) * 0.92, 1.0);
  }

  // Edge bezel: stronger refraction near rim
  let bezel = max(u.bezel, 1.0);
  let edge = clamp(1.0 - abs(d) / bezel, 0.0, 1.0);
  let edge2 = edge * edge;

  // Approximate gradient via finite differences
  let eps = 1.5;
  let dx = sdRoundRect(p + vec2f(eps, 0.0), box, radius) - sdRoundRect(p - vec2f(eps, 0.0), box, radius);
  let dy = sdRoundRect(p + vec2f(0.0, eps), box, radius) - sdRoundRect(p - vec2f(0.0, eps), box, radius);
  var n = vec2f(dx, dy);
  let nl = length(n);
  if (nl > 1e-4) { n = n / nl; } else { n = vec2f(0.0); }

  let thick = u.thickness * (0.35 + 0.65 * edge2);
  var refrUv = uv - n * thick * 0.04;

  // Mild whole-surface lens
  let lens = (uv - 0.5) * (1.0 - 0.06 * u.thickness);
  refrUv = mix(refrUv, lens + 0.5, 0.25);

  let chroma = u.chroma * edge2;
  let cR = sampleBg(refrUv + n * chroma * 0.004, u.time);
  let cG = sampleBg(refrUv, u.time);
  let cB = sampleBg(refrUv - n * chroma * 0.004, u.time);
  var col = vec3f(cR.r, cG.g, cB.b);

  // Specular rim
  let L = normalize(u.light);
  let spec = pow(max(dot(n, L), 0.0), 28.0) * edge2;
  let rim = pow(edge, 1.6) * 0.22;
  col += vec3f(1.0) * (spec * 0.55 + rim * 0.35);

  // Tint / frost body
  col = mix(col, u.tint.rgb, u.tint.a * (0.35 + 0.25 * (1.0 - edge)));

  // Inner highlight band (top)
  let topGlow = smoothstep(0.0, 0.55, 1.0 - uv.y) * 0.08 * (1.0 - edge * 0.5);
  col += vec3f(topGlow);

  let alpha = mix(0.96, 1.0, edge2);
  return vec4f(clamp(col, vec3f(0.0), vec3f(1.2)), alpha);
}
`
