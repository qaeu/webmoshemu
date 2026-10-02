// Inverse 8x8 DCT, first half: texel (x, o.y + v) holds coefficient row v
// transformed back along x. reconstruct.frag finishes the transform over v.
uniform sampler2D uCoef;
uniform sampler2D uState;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (!isInter(texelFetch(uState, p / MB, 0))) {
    fragColor = vec4(0.0);
    return;
  }
  int ox = (p.x / 8) * 8;
  int x = p.x - ox;
  vec3 acc = vec3(0.0);
  for (int u = 0; u < 8; u++) {
    acc += texelFetch(uCoef, ivec2(ox + u, p.y), 0).rgb * basis(u, x);
  }
  fragColor = vec4(acc, 1.0);
}
