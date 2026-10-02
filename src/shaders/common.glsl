precision highp float;
precision highp int;

#define MB 16
#define SB 8

out highp vec4 fragColor;

// BT.601 full-range, as used by JPEG/H.264 "full" profiles.
vec3 rgb2ycc(vec3 c) {
  return vec3(
    dot(c, vec3(0.299, 0.587, 0.114)),
    dot(c, vec3(-0.168736, -0.331264, 0.5)),
    dot(c, vec3(0.5, -0.418688, -0.081312))
  );
}
vec3 ycc2rgb(vec3 c) {
  return vec3(
    c.x + 1.402 * c.z,
    c.x - 0.344136 * c.y - 0.714136 * c.z,
    c.x + 1.772 * c.y
  );
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

// Partitions. Intra/inter lives per 16x16 macroblock (state); vectors live
// per 8x8 sub-block (sub), where b holds the macroblock's partition code, the
// same in all four siblings: 0 = 16x16, 1 = 16x8 (two rows), 2 = 8x16 (two
// columns), 3 = four 8x8. The helpers take values the pass has already
// fetched (or samplers as arguments), so no samplers are declared here.

// The bottom-left sub-block of sb's partition group.
ivec2 groupAnchor(float code, ivec2 sb) {
  int c = int(code + 0.5);
  ivec2 o = (sb / 2) * 2;
  return c == 0 ? o : c == 1 ? ivec2(o.x, sb.y) : c == 2 ? ivec2(sb.x, o.y) : sb;
}

// A partition group's size in px.
ivec2 groupExtent(float code) {
  int c = int(code + 0.5);
  return c == 0 ? ivec2(16) : c == 1 ? ivec2(16, 8) : c == 2 ? ivec2(8, 16) : ivec2(8);
}

// An unsplit macroblock keeps its own seed; each partition gets one from its anchor.
float groupSeed(vec4 s, vec4 sub, ivec2 p) {
  if (sub.b < 0.5) return s.a;
  return hash12(vec2(groupAnchor(sub.b, p / SB)) + 7.1);
}

// Every macroblock is inter-coded (P) unless the encoder chose intra for it
// this step (blocks.frag). The only inter test: every DCT pass, reconstruct
// and present must agree on it. s = state at p / MB.
bool isInter(vec4 s) {
  return s.g < 0.5;
}

// Motion-compensated prediction of pixel p from ref with fetch offset v (px),
// as YCbCr: luma at integer-pel, chroma on the 4:2:0 grid in 2 px steps, both
// rounded with the step's shared dither (phase.xy luma, phase.zw chroma).
// Fetches past the frame clamp to its edge, like unrestricted motion vectors
// over a reference padded by repeating its border.
vec3 predict(sampler2D ref, ivec2 p, vec2 v, vec4 phase) {
  ivec2 size = textureSize(ref, 0);
  ivec2 mv = ivec2(floor(v + phase.xy));
  vec3 ycc;
  ycc.x = rgb2ycc(texelFetch(ref, clamp(p + mv, ivec2(0), size - 1), 0).rgb).x;
  ivec2 mvc = ivec2(floor(v * 0.5 + phase.zw)) * 2;
  ivec2 c0 = clamp((p / 2) * 2 + mvc, ivec2(0), size - 2);
  ycc.yz = 0.25 * (
      rgb2ycc(texelFetch(ref, c0, 0).rgb).yz
    + rgb2ycc(texelFetch(ref, c0 + ivec2(1, 0), 0).rgb).yz
    + rgb2ycc(texelFetch(ref, c0 + ivec2(0, 1), 0).rgb).yz
    + rgb2ycc(texelFetch(ref, c0 + ivec2(1, 1), 0).rgb).yz);
  return ycc;
}

// A pixel's fetch offset: its partition's pointer offset (sub.rg) on top of
// the background's measured motion, so every block follows the scene exactly.
vec2 pixelMv(vec4 sub, vec4 flow) {
  return sub.rg - flow.rg;
}

// Orthonormal 8x8 DCT basis: 0.5 * C(k) * cos((2x+1)k*pi/16).
uniform float uBasis[64];
float basis(int k, int x) { return uBasis[k * 8 + x]; }
