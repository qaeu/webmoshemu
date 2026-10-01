// Per-macroblock state, one texel per 16x16 block:
//   rg = motion vector (fetch offset, internal px), b = heat, a = random seed.
// Near the pointer the vectors are pulled towards a spiral vortex plus the pointer's
// drag; elsewhere they coast and decay, so moshed regions keep streaming.
// The pointer's zone is a disc whose edge is pushed in and out by drifting
// simplex noise. Heat never fades on its own: like a real moshed stream, a
// block only heals once the background moves strongly enough under it.
uniform sampler2D uState;
uniform sampler2D uFlow;
uniform vec2 uPointer;     // internal px, origin bottom-left
uniform vec2 uVelocity;    // internal px per step
uniform float uActive;
uniform float uRadius;
uniform float uTime;
uniform float uSwirl;
uniform float uBreath;
uniform float uInflow;
uniform float uMvDecay;
uniform float uNoiseScale; // internal px per noise unit
uniform float uNoiseAmp;   // edge displacement, as a fraction of uRadius
uniform float uNoiseSpeed;
uniform vec2 uHealSpeed;   // background speed (px/step) where healing starts / is full
uniform float uHealRate;   // heat removed per step at full background speed

// 3D simplex noise (Ashima Arts / Stefan Gustavson, MIT).
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);

  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);

  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;

  i = mod289(i);
  vec4 p = permute(permute(permute(
            i.z + vec4(0.0, i1.z, i2.z, 1.0))
          + i.y + vec4(0.0, i1.y, i2.y, 1.0))
          + i.x + vec4(0.0, i1.x, i2.x, 1.0));

  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;

  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);

  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);

  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));

  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);

  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 105.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

void main() {
  ivec2 b = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uState, b, 0);
  float seed = hash12(vec2(b) + 0.37);

  vec2 c = (vec2(b) + 0.5) * float(MB);
  vec2 d = c - uPointer;
  float r = length(d);

  // Two octaves of screen-anchored noise drifting through time, so the zone
  // edge both morphs in place and changes shape as the pointer moves through it.
  vec3 q = vec3(c / uNoiseScale, uTime * uNoiseSpeed);
  float n = 0.7 * snoise(q) + 0.3 * snoise(q * vec3(2.3, 2.3, 1.6) + 17.0);
  float edge = 1.0 - r / uRadius + uNoiseAmp * n;
  float w = uActive * smoothstep(0.0, 0.35, edge);

  vec3 flow = texelFetch(uFlow, b, 0).rgb;
  float heal = uHealRate * smoothstep(uHealSpeed.x, uHealSpeed.y, flow.b);
  float heat = max(s.b - heal, w);

  float R = uRadius * (1.0 + uNoiseAmp);
  vec2 dir = r > 0.5 ? d / r : vec2(0.0);
  float prof = sin(3.14159265 * clamp(r / R, 0.0, 1.0));
  // Tangential swirl plus a steady inward drain (fetching from further out
  // pulls fresh blocks in from the rim), breathing slowly.
  vec2 vortex = vec2(-dir.y, dir.x) * prof * uSwirl
              + dir * prof * (uInflow + uBreath * sin(uTime * 0.9 - r * 0.05));
  vec2 target = vortex - uVelocity;

  vec2 mv = mix(s.rg * uMvDecay, target, w * 0.35);
  float m = length(mv);
  if (m > 24.0) mv *= 24.0 / m;

  fragColor = vec4(mv, heat, seed);
}
