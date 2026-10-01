// Per-macroblock state, one texel per 16x16 block:
//   r = melt latch (0/1), g = unused, b = heat, a = random seed.
// Vectors live per 8x8 sub-block in sub.frag, which runs after this pass.
// The pointer's zone comes from mask.frag (a soft disc times drifting simplex
// noise). Inside it, in proportion to the pointer's speed, blocks heat up; a
// still pointer does nothing.
// Heat never fades on its own: a block only heals once the background moves
// strongly enough under it.
// Melt: a seeded share of inter blocks whose vectors get strong switch to
// bilinear (sub-pel) motion compensation. The choice latches until the block
// goes intra, so a block doesn't flicker between crisp and melted as its
// vector relaxes.
uniform sampler2D uState;
uniform sampler2D uSub;    // last step's partitions
uniform sampler2D uFlow;
uniform sampler2D uMask;
uniform vec2 uVelocity;    // internal px per step
uniform float uSpeedRef;   // pointer speed (px/step) for full effect
uniform vec2 uHealSpeed;   // background speed (px/step) where healing starts / is full
uniform float uHealRate;   // heat removed per step at full background speed
uniform float uCut;        // 1 on the step after a source swap: every block goes inter
uniform float uMeltMv;     // pointer offset (px) a block needs before it can melt
uniform float uMeltFrac;   // share of blocks that melt

void main() {
  ivec2 b = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uState, b, 0);
  float seed = hash12(vec2(b) + 0.37);

  float w = texelFetch(uMask, b, 0).r;
  float gain = min(length(uVelocity) / uSpeedRef, 1.0);

  vec3 flow = texelFetch(uFlow, b, 0).rgb;
  float heal = uHealRate * smoothstep(uHealSpeed.x, uHealSpeed.y, flow.b);
  float heat = max(max(s.b, uCut) - heal, w * gain);

  vec4 ns = vec4(0.0, 0.0, heat, seed);
  bool inter = false;
  float mv = 0.0;
  for (int i = 0; i < 4; i++) {
    ivec2 sb = b * 2 + ivec2(i & 1, i >> 1);
    vec4 sub = texelFetch(uSub, sb, 0);
    inter = inter || isInterAt(ns, sub, sb * SB);
    mv = max(mv, length(sub.rg));
  }
  bool melt = inter && (s.r > 0.5 || (mv > uMeltMv && hash12(vec2(b) + 3.1) < uMeltFrac));

  fragColor = vec4(melt ? 1.0 : 0.0, 0.0, heat, seed);
}
