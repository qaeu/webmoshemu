// Forward 8x8 DCT of the source's frame-to-frame change (the residual an
// honest encoder would code with a zero vector), quantised with an H.264-style
// dead zone. One output texel per coefficient, laid out block-locally.
uniform sampler2D uCur;
uniform sampler2D uPrev;
uniform sampler2D uState;
uniform float uQstep;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (!isInter(texelFetch(uState, p / MB, 0))) {
    fragColor = vec4(0.0);
    return;
  }
  ivec2 o = (p / 8) * 8;
  ivec2 k = p - o;
  vec3 acc = vec3(0.0);
  for (int y = 0; y < 8; y++) {
    for (int x = 0; x < 8; x++) {
      ivec2 q = o + ivec2(x, y);
      vec3 res = rgb2ycc(texelFetch(uCur, q, 0).rgb) - rgb2ycc(texelFetch(uPrev, q, 0).rgb);
      acc += res * basis(k.x, x) * basis(k.y, y);
    }
  }
  vec3 Q = uQstep * (1.0 + float(k.x + k.y) * 0.28) * vec3(1.0, 1.6, 1.6);
  fragColor = vec4(sign(acc) * floor(abs(acc) / Q + 1.0 / 6.0) * Q, 1.0);
}
