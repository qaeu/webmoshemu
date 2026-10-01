// Forward 8x8 DCT, first half: transform each row of the source's
// frame-to-frame change (the residual an honest encoder would code with a zero
// vector). Texel (o.x + u, y) holds row y's coefficient u. dctCols.frag
// finishes the transform down the columns.
uniform sampler2D uCur;
uniform sampler2D uPrev;
uniform sampler2D uState;
uniform sampler2D uSub;

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (!isInterAt(texelFetch(uState, p / MB, 0), texelFetch(uSub, p / SB, 0), p)) {
    fragColor = vec4(0.0);
    return;
  }
  int ox = (p.x / 8) * 8;
  int u = p.x - ox;
  vec3 acc = vec3(0.0);
  for (int x = 0; x < 8; x++) {
    ivec2 q = ivec2(ox + x, p.y);
    vec3 res = rgb2ycc(texelFetch(uCur, q, 0).rgb) - rgb2ycc(texelFetch(uPrev, q, 0).rgb);
    acc += res * basis(u, x);
  }
  fragColor = vec4(acc, 1.0);
}
