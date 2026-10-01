// out = MC(previous decoded frame, mv) + IDCT(Q(residual)) for inter blocks,
// the clean source for intra blocks. Luma is copied per 16x16 block at
// integer-pel; chroma is predicted on the 4:2:0 grid in 2px steps. Vectors are
// rounded with a per-step dither shared by every block, so sub-pixel motion
// (the slow background drift) advances in whole-pixel jumps at the right
// average rate instead of rounding to zero or blurring through interpolation.
uniform sampler2D uRef;
uniform sampler2D uCur;
uniform sampler2D uCoef;
uniform sampler2D uState;
uniform sampler2D uFlow;
uniform float uResidualGain;
uniform vec4 uPhase;       // xy = luma rounding dither, zw = chroma

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uState, p / MB, 0);
  if (!isInter(s)) {
    fragColor = vec4(texelFetch(uCur, p, 0).rgb, 1.0);
    return;
  }
  ivec2 size = textureSize(uRef, 0);
  vec2 v = blockMv(s, texelFetch(uFlow, p / MB, 0));
  ivec2 mv = ivec2(floor(v + uPhase.xy));

  float y = rgb2ycc(texelFetch(uRef, clamp(p + mv, ivec2(0), size - 1), 0).rgb).x;

  ivec2 mvc = ivec2(floor(v * 0.5 + uPhase.zw)) * 2;
  ivec2 c0 = clamp((p / 2) * 2 + mvc, ivec2(0), size - 2);
  vec2 cbcr = 0.25 * (
      rgb2ycc(texelFetch(uRef, c0, 0).rgb).yz
    + rgb2ycc(texelFetch(uRef, c0 + ivec2(1, 0), 0).rgb).yz
    + rgb2ycc(texelFetch(uRef, c0 + ivec2(0, 1), 0).rgb).yz
    + rgb2ycc(texelFetch(uRef, c0 + ivec2(1, 1), 0).rgb).yz);

  ivec2 o = (p / 8) * 8;
  ivec2 xy = p - o;
  vec3 res = vec3(0.0);
  for (int v = 0; v < 8; v++) {
    for (int u = 0; u < 8; u++) {
      res += texelFetch(uCoef, o + ivec2(u, v), 0).rgb * basis(u, xy.x) * basis(v, xy.y);
    }
  }

  vec3 ycc = vec3(y, cbcr) + uResidualGain * res;
  fragColor = vec4(clamp(ycc2rgb(ycc), 0.0, 1.0), 1.0);
}
