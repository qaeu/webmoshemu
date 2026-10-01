// Per-sub-block vectors and partitions, one texel per 8x8 sub-block:
//   rg = the partition's pointer offset (internal px), b = the macroblock's
//   partition code 0..3 (see common.glsl), a = unused.
// A pixel's full vector is pixelMv(): this offset on top of -flow.
// Inside the pointer's zone, in proportion to its speed, offsets are pulled
// towards a spiral vortex plus the pointer's drag. Each sub-block gets its own
// target (the vortex at its centre plus a seeded twist, like an encoder's
// per-partition search landing in different local minima), and the macroblock
// picks its partition shape by rate-distortion: the error of sharing vectors
// across the shape's groups plus lambda times the bits to code the extra
// vectors. Everywhere else the offsets decay to zero, leaving only the
// background's own motion, like later P-frames of the real footage, so stale
// moshed pixels keep their colour but drift with the scene beneath.
// All four siblings compute the same decision and group values, so a group's
// texels stay bit-equal.
uniform sampler2D uSub;
uniform sampler2D uState;
uniform sampler2D uMask;
uniform vec2 uPointer;     // internal px, origin bottom-left
uniform vec2 uVelocity;    // internal px per step
uniform float uRadius;
uniform float uTime;
uniform float uSwirl;
uniform float uBreath;
uniform float uInflow;
uniform float uMvRelax;    // per-step decay of the pointer's offset
uniform float uSpeedRef;   // pointer speed (px/step) for full effect
uniform float uSubShear;   // 0 = every sub-block takes the macroblock's vortex, 1 = its own
uniform float uSubTwist;   // seeded per-sub-block rotation / gain of the target
uniform float uLamLo;      // rate-distortion lambda range (px^2 per vector), by block seed
uniform float uLamHi;
uniform float uBloomFrac;  // share of macroblocks whose offsets persist
uniform float uBloomRelax; // their relax, as a fraction of uMvRelax

vec2 vortexAt(vec2 c) {
  vec2 d = c - uPointer;
  float r = length(d);
  vec2 dir = r > 0.5 ? d / r : vec2(0.0);
  float prof = sin(3.14159265 * clamp(r / uRadius, 0.0, 1.0));
  // Tangential swirl plus a steady inward drain (fetching from further out
  // pulls fresh blocks in from the rim), breathing slowly.
  return vec2(-dir.y, dir.x) * prof * uSwirl
       + dir * prof * (uInflow + uBreath * sin(uTime * 0.9 - r * 0.05));
}

// Group id of sibling i (0..3, x + 2y) under a partition code.
int groupOf(int code, int i) {
  return code == 0 ? 0 : code == 1 ? i >> 1 : code == 2 ? i & 1 : i;
}

float pairErr(vec2 a, vec2 b) {
  vec2 d = a - b;
  return 0.5 * dot(d, d);
}

void main() {
  ivec2 sb = ivec2(gl_FragCoord.xy);
  ivec2 mb = sb / 2;
  ivec2 o = mb * 2;
  int self = (sb.x & 1) + 2 * (sb.y & 1);
  vec4 s = texelFetch(uState, mb, 0);
  float w = texelFetch(uMask, mb, 0).r;
  float gain = min(length(uVelocity) / uSpeedRef, 1.0);
  float wg = w * gain;

  vec2 v16 = vortexAt((vec2(mb) + 0.5) * float(MB));
  vec2 t[4];
  vec2 prev[4];
  for (int i = 0; i < 4; i++) {
    ivec2 q = o + ivec2(i & 1, i >> 1);
    vec2 v = gain * (v16 + uSubShear * (vortexAt((vec2(q) + 0.5) * float(SB)) - v16));
    float a = (hash12(vec2(q) + 17.0) - 0.5) * 2.2 * uSubTwist;
    float k = 1.0 + (hash12(vec2(q) + 41.0) - 0.5) * 1.6 * uSubTwist;
    v = k * mat2(cos(a), sin(a), -sin(a), cos(a)) * v;
    t[i] = w * (v - uVelocity);
    prev[i] = texelFetch(uSub, q, 0).rg;
  }

  // Rate-distortion: J = E_shape + lambda * bits, with a bonus for keeping
  // last step's shape.
  int code = 0;
  if (wg >= 0.05) {
    vec2 m = 0.25 * (t[0] + t[1] + t[2] + t[3]);
    vec2 d0 = t[0] - m, d1 = t[1] - m, d2 = t[2] - m, d3 = t[3] - m;
    float lam = mix(uLamLo, uLamHi, s.a);
    float J[4];
    J[0] = dot(d0, d0) + dot(d1, d1) + dot(d2, d2) + dot(d3, d3);
    J[1] = pairErr(t[0], t[1]) + pairErr(t[2], t[3]) + lam;
    J[2] = pairErr(t[0], t[2]) + pairErr(t[1], t[3]) + lam;
    J[3] = 3.0 * lam;
    J[int(texelFetch(uSub, o, 0).b + 0.5)] -= 0.3;
    for (int c = 1; c < 4; c++) {
      if (J[c] < J[code]) code = c;
    }
  }

  // Group means, summed in a fixed order so every sibling gets the same bits.
  int g = groupOf(code, self);
  vec2 tm = vec2(0.0);
  vec2 pm = vec2(0.0);
  float n = 0.0;
  for (int i = 0; i < 4; i++) {
    if (groupOf(code, i) != g) continue;
    tm += t[i];
    pm += prev[i];
    n += 1.0;
  }
  tm /= n;
  pm /= n;

  // Only the pointer's offset relaxes; the background part of the vector is
  // always the measured flow (added in pixelMv), whatever the source. Bloom
  // blocks hold their vector much longer, like a duplicated P-frame.
  float relax = uMvRelax * (hash12(vec2(mb) + 2.3) < uBloomFrac ? uBloomRelax : 1.0);
  vec2 off = pm * (1.0 - relax);
  off = mix(off, tm, wg * 0.35);
  float l = length(off);
  if (l > 24.0) off *= 24.0 / l;

  fragColor = vec4(off, float(code), 0.0);
}
