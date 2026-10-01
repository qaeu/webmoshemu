// Per-macroblock state, one texel per 16x16 block:
//   rg = motion vector (fetch offset, internal px), b = heat, a = random seed.
// The pointer's zone comes from mask.frag (a soft disc times drifting simplex
// noise). Inside it, in proportion to the pointer's speed, blocks heat
// up and their vectors are pulled towards a spiral vortex plus the pointer's
// drag; a still pointer does nothing. Everywhere else the vectors relax towards
// the background's own motion, like later P-frames of the real footage, so
// stale moshed pixels keep their colour but drift with the scene beneath.
// Heat never fades on its own: a block only heals once the background moves
// strongly enough under it.
uniform sampler2D uState;
uniform sampler2D uFlow;
uniform sampler2D uMask;
uniform vec2 uPointer;     // internal px, origin bottom-left
uniform vec2 uVelocity;    // internal px per step
uniform float uRadius;
uniform float uTime;
uniform float uSwirl;
uniform float uBreath;
uniform float uInflow;
uniform float uMvRelax;    // per-step pull of vectors towards the background's motion
uniform float uSpeedRef;   // pointer speed (px/step) for full effect
uniform vec2 uHealSpeed;   // background speed (px/step) where healing starts / is full
uniform float uHealRate;   // heat removed per step at full background speed

void main() {
  ivec2 b = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uState, b, 0);
  float seed = hash12(vec2(b) + 0.37);

  vec2 c = (vec2(b) + 0.5) * float(MB);
  vec2 d = c - uPointer;
  float r = length(d);

  float w = texelFetch(uMask, b, 0).r;
  float gain = min(length(uVelocity) / uSpeedRef, 1.0);

  vec3 flow = texelFetch(uFlow, b, 0).rgb;
  float heal = uHealRate * smoothstep(uHealSpeed.x, uHealSpeed.y, flow.b);
  float heat = max(s.b - heal, w * gain);

  float R = uRadius;
  vec2 dir = r > 0.5 ? d / r : vec2(0.0);
  float prof = sin(3.14159265 * clamp(r / R, 0.0, 1.0));
  // Tangential swirl plus a steady inward drain (fetching from further out
  // pulls fresh blocks in from the rim), breathing slowly.
  vec2 vortex = vec2(-dir.y, dir.x) * prof * uSwirl
              + dir * prof * (uInflow + uBreath * sin(uTime * 0.9 - r * 0.05));
  vec2 target = w * (gain * vortex - uVelocity);

  // Fetching from -flow copies the reference along with the background.
  vec2 mv = mix(s.rg, -flow.rg, uMvRelax);
  mv = mix(mv, target, w * gain * 0.35);
  float m = length(mv);
  if (m > 24.0) mv *= 24.0 / m;

  fragColor = vec4(mv, heat, seed);
}
