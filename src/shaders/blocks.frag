// Per-macroblock state, one texel per 16x16 block:
//   r = melt latch (0/1), g = intra (0/1), b = unused, a = random seed.
// Vectors live per 8x8 sub-block in sub.frag, which runs after this pass.
//
// Intra: the encoder's mode decision, made on the clean source as a real
// encoder makes it on its own (uncorrupted) reconstruction. Inter predicts the
// block from the previous source frame with the background's vector; intra
// predicts it from the current frame's already-coded neighbours (the row
// above and the column to the left, H.264 Intra16x16 vertical, horizontal or
// DC). The block goes intra when the best intra mode's error beats the inter
// error by uIntraBias. That happens where the scene shows something the
// previous frame didn't have: content entering at the frame edge as the
// camera pans, disocclusions, cuts within the clip, fast change. It is the
// only thing that clears mosh.
//
// Melt: a seeded share of inter blocks whose pointer offsets get strong switch
// to bicubic (sub-pel) motion compensation. The choice latches until the
// offsets relax below uMvOn or the block goes intra, so a block doesn't
// flicker between crisp and melted as its vector relaxes.
uniform sampler2D uState;
uniform sampler2D uSub;    // last step's partitions
uniform sampler2D uCur;
uniform sampler2D uPrev;
uniform sampler2D uFlow;
uniform vec4 uPhase;       // as in reconstruct.frag
uniform float uIntraBias;  // mean |error| per pixel intra must win by
uniform float uMvOn;       // pointer offset (px) below which the melt latch clears
uniform float uMeltMv;     // pointer offset (px) a block needs before it can melt
uniform float uMeltFrac;   // share of blocks that melt

float sad(vec3 a, vec3 b) {
  vec3 d = abs(a - b);
  return d.x + d.y + d.z;
}

void main() {
  ivec2 b = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uState, b, 0);
  float seed = hash12(vec2(b) + 0.37);
  ivec2 size = textureSize(uCur, 0);
  ivec2 o = b * MB;
  vec2 flow = texelFetch(uFlow, b, 0).rg;

  // Neighbours in coding (raster) order: the row above is at higher y.
  bool hasTop = o.y + MB < size.y;
  bool hasLeft = o.x > 0;
  vec3 top[MB];
  vec3 left[MB];
  vec3 dc = vec3(0.0);
  float nDc = 0.0;
  for (int i = 0; i < MB; i++) {
    top[i] = hasTop ? rgb2ycc(texelFetch(uCur, ivec2(o.x + i, o.y + MB), 0).rgb) : vec3(0.0);
    left[i] = hasLeft ? rgb2ycc(texelFetch(uCur, ivec2(o.x - 1, o.y + i), 0).rgb) : vec3(0.0);
    dc += top[i] + left[i];
  }
  nDc = float(MB) * (float(hasTop) + float(hasLeft));
  // With no neighbours, DC predicts mid-grey (128 in H.264).
  dc = nDc > 0.0 ? dc / nDc : vec3(0.5, 0.0, 0.0);

  float eInter = 0.0, eV = 0.0, eH = 0.0, eDc = 0.0;
  for (int y = 0; y < MB; y++) {
    for (int x = 0; x < MB; x++) {
      ivec2 p = o + ivec2(x, y);
      vec3 c = rgb2ycc(texelFetch(uCur, p, 0).rgb);
      eInter += sad(c, predict(uPrev, p, -flow, uPhase));
      eV += sad(c, top[x]);
      eH += sad(c, left[y]);
      eDc += sad(c, dc);
    }
  }
  float eIntra = eDc;
  if (hasTop) eIntra = min(eIntra, eV);
  if (hasLeft) eIntra = min(eIntra, eH);
  bool intra = eIntra + uIntraBias * float(MB * MB) < eInter;

  float mv = 0.0;
  for (int i = 0; i < 4; i++) {
    mv = max(mv, length(texelFetch(uSub, b * 2 + ivec2(i & 1, i >> 1), 0).rg));
  }
  bool melt = !intra && (s.r > 0.5 ? mv > uMvOn : mv > uMeltMv && hash12(vec2(b) + 3.1) < uMeltFrac);

  fragColor = vec4(melt ? 1.0 : 0.0, intra ? 1.0 : 0.0, 0.0, seed);
}
