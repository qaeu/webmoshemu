// Forward 8x8 DCT, second half: transform the row coefficients from
// dctRows.frag down each column, then quantise with an H.264-style dead zone.
// One output texel per coefficient, laid out block-locally.
uniform sampler2D uTmp;
uniform sampler2D uState;
uniform sampler2D uSub;
uniform float uQstep;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (!isInterAt(texelFetch(uState, p / MB, 0), texelFetch(uSub, p / SB, 0), p)) {
    fragColor = vec4(0.0);
    return;
  }
  ivec2 o = (p / 8) * 8;
  ivec2 k = p - o;
  vec3 acc = vec3(0.0);
  for (int y = 0; y < 8; y++) {
    acc += texelFetch(uTmp, ivec2(p.x, o.y + y), 0).rgb * basis(k.y, y);
  }
  vec3 Q = uQstep * (1.0 + float(k.x + k.y) * 0.28) * vec3(1.0, 1.6, 1.6);
  fragColor = vec4(sign(acc) * floor(abs(acc) / Q + 1.0 / 6.0) * Q, 1.0);
}
