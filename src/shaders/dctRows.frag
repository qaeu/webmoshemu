// Forward 8x8 DCT, first half: transform each row of the residual an honest
// encoder codes for this frame: the source minus its prediction from the
// previous source frame along the background's vector. The encoder never sees
// the pointer's offsets, so moshed blocks get a residual meant for a different
// prediction. Texel (o.x + u, y) holds row y's coefficient u. dctCols.frag
// finishes the transform down the columns.
uniform sampler2D uCur;
uniform sampler2D uPrev;
uniform sampler2D uState;
uniform sampler2D uFlow;
uniform vec4 uPhase;       // as in reconstruct.frag

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  if (!isInter(texelFetch(uState, p / MB, 0))) {
    fragColor = vec4(0.0);
    return;
  }
  int ox = (p.x / 8) * 8;
  int u = p.x - ox;
  vec2 flow = texelFetch(uFlow, p / MB, 0).rg;
  vec3 acc = vec3(0.0);
  for (int x = 0; x < 8; x++) {
    ivec2 q = ivec2(ox + x, p.y);
    vec3 res = rgb2ycc(texelFetch(uCur, q, 0).rgb) - predict(uPrev, q, -flow, uPhase);
    acc += res * basis(u, x);
  }
  fragColor = vec4(acc, 1.0);
}
