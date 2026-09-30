// Per-macroblock state, one texel per 16x16 block:
//   rg = motion vector (fetch offset, internal px), b = heat, a = random seed.
// Near the pointer the vectors are pulled towards a spiral vortex plus the pointer's
// drag; elsewhere they coast and decay, so moshed regions keep streaming.
uniform sampler2D uState;
uniform vec2 uPointer;     // internal px, origin bottom-left
uniform vec2 uVelocity;    // internal px per step
uniform float uActive;
uniform float uRadius;
uniform float uTime;
uniform float uSwirl;
uniform float uBreath;
uniform float uInflow;
uniform float uHeatDecay;
uniform float uMvDecay;

void main() {
  ivec2 b = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uState, b, 0);
  float seed = hash12(vec2(b) + 0.37);

  vec2 d = (vec2(b) + 0.5) * float(MB) - uPointer;
  float r = length(d);
  float R = uRadius * (0.75 + 0.5 * seed);
  float w = uActive * (1.0 - smoothstep(R * 0.45, R, r));

  float heat = max(s.b * uHeatDecay, w);

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
