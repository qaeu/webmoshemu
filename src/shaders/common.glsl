precision highp float;
precision highp int;

#define MB 16

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

// A macroblock is inter-coded (P) while its heat is above its own random
// threshold, so the zone edge is ragged and heals block by block.
bool isInter(vec4 state) {
  return state.b > 0.06 + 0.55 * state.a;
}

// A block's fetch offset: the pointer's own offset (state.rg) on top of the
// background's measured motion, so every block follows the scene exactly.
vec2 blockMv(vec4 state, vec4 flow) {
  return state.rg - flow.rg;
}

// Orthonormal 8x8 DCT basis: 0.5 * C(k) * cos((2x+1)k*pi/16).
uniform float uBasis[64];
float basis(int k, int x) { return uBasis[k * 8 + x]; }
