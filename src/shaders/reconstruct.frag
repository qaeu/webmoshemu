// out = MC(previous decoded frame, mv) + IDCT(Q(residual)) for inter blocks,
// the clean source for intra blocks. Luma is copied per 16x16 block at
// integer-pel; chroma is predicted on the 4:2:0 grid with floor(mv / 2).
uniform sampler2D uRef;
uniform sampler2D uCur;
uniform sampler2D uCoef;
uniform sampler2D uState;
uniform float uResidualGain;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uState, p / MB, 0);
  if (!isInter(s)) {
    fragColor = vec4(texelFetch(uCur, p, 0).rgb, 1.0);
    return;
  }
  ivec2 size = textureSize(uRef, 0);
  ivec2 mv = ivec2(floor(s.rg + 0.5));

  float y = rgb2ycc(texelFetch(uRef, clamp(p + mv, ivec2(0), size - 1), 0).rgb).x;

  ivec2 mvc = ivec2(floor(vec2(mv) * 0.5)) * 2;
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
