// out = MC(previous decoded frame, mv) + IDCT(Q(residual)) for inter blocks,
// the clean source for intra blocks. Luma is copied per partition at
// integer-pel; chroma is predicted on the 4:2:0 grid in 2px steps. Vectors are
// rounded with a per-step dither shared by every block, so sub-pixel motion
// (the slow background drift) advances in whole-pixel jumps at the right
// average rate instead of rounding to zero or blurring through interpolation.
//
// Melted blocks (state.r, latched in blocks.frag) instead predict with one
// bilinear fetch, so content smears and softens as it travels; an unsplit
// melted block also interpolates its vector between neighbouring sub-blocks,
// so it curls rather than sliding rigidly. Near-healed 8x8 partitions drip
// their neighbour's edge into themselves. Inter pixels also drift in colour:
// chroma lags the pointer's offset, partitions pick up a seeded Cb/Cr bias,
// and a share of them over-apply their residual.
uniform sampler2D uRef;    // linear filtered; texelFetch everywhere but melt
uniform sampler2D uCur;
uniform sampler2D uTmp;    // row-inverted coefficients from idctRows.frag
uniform sampler2D uState;
uniform sampler2D uSub;    // linear filtered; texelFetch everywhere but warp
uniform sampler2D uFlow;
uniform float uResidualGain;
uniform vec4 uPhase;       // xy = luma rounding dither, zw = chroma
uniform float uChromaLag;  // chroma's share of the pointer offset
uniform float uDcDrift;    // per-step Cb/Cr bias at full heat
uniform float uResBloomFrac;
uniform float uResBloom;   // residual gain on that share of partitions
uniform float uSmear;      // edge blend at the partition's source edge
uniform float uSmearBand;  // heat above threshold where 8x8 partitions smear

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uState, p / MB, 0);
  vec4 sub = texelFetch(uSub, p / SB, 0);
  if (!isInterAt(s, sub, p)) {
    fragColor = vec4(texelFetch(uCur, p, 0).rgb, 1.0);
    return;
  }
  ivec2 size = textureSize(uRef, 0);
  vec2 flow = texelFetch(uFlow, p / MB, 0).rg;
  vec2 off = sub.rg;
  ivec2 anchor = groupAnchor(sub.b, p / SB);
  bool melt = s.r > 0.5;

  vec3 ycc;
  if (melt) {
    // Warp: interpolate between sub-block offsets, but only where the block
    // is unsplit, so partition edges survive.
    if (sub.b < 0.5) off = texture(uSub, (vec2(p) + 0.5) / vec2(size)).rg;
    vec2 v = off - flow;
    vec2 vc = off * uChromaLag - flow;
    ycc.x = rgb2ycc(texture(uRef, (vec2(p) + 0.5 + v) / vec2(size)).rgb).x;
    ycc.yz = rgb2ycc(texture(uRef, (vec2(p) + 0.5 + vc) / vec2(size)).rgb).yz;
  } else {
    vec2 v = off - flow;
    ivec2 mv = ivec2(floor(v + uPhase.xy));
    ycc.x = rgb2ycc(texelFetch(uRef, clamp(p + mv, ivec2(0), size - 1), 0).rgb).x;

    ivec2 mvc = ivec2(floor((off * uChromaLag - flow) * 0.5 + uPhase.zw)) * 2;
    ivec2 c0 = clamp((p / 2) * 2 + mvc, ivec2(0), size - 2);
    ycc.yz = 0.25 * (
        rgb2ycc(texelFetch(uRef, c0, 0).rgb).yz
      + rgb2ycc(texelFetch(uRef, c0 + ivec2(1, 0), 0).rgb).yz
      + rgb2ycc(texelFetch(uRef, c0 + ivec2(0, 1), 0).rgb).yz
      + rgb2ycc(texelFetch(uRef, c0 + ivec2(1, 1), 0).rgb).yz);
  }

  // Rim smear: an 8x8 partition about to heal extrudes the decoded edge just
  // outside it (left column or the row above, shifted by its vector) into
  // itself, fading with distance like a drip.
  if (sub.b > 2.5 && s.b < interThreshold(groupSeed(s, sub, p)) + uSmearBand) {
    ivec2 sb0 = (p / SB) * SB;
    bool horiz = hash12(vec2(anchor) + 5.3) < 0.5;
    ivec2 src = horiz ? ivec2(sb0.x - 1, p.y) : ivec2(p.x, sb0.y + SB);
    float d = horiz ? float(p.x - sb0.x) : float(sb0.y + SB - 1 - p.y);
    ivec2 mv = ivec2(floor(sub.rg - flow + uPhase.xy));
    vec3 edge = rgb2ycc(texelFetch(uRef, clamp(src + mv, ivec2(0), size - 1), 0).rgb);
    ycc = mix(ycc, edge, uSmear * (1.0 - d / float(SB)));
  }

  ivec2 o = (p / 8) * 8;
  ivec2 xy = p - o;
  vec3 res = vec3(0.0);
  for (int v = 0; v < 8; v++) {
    res += texelFetch(uTmp, ivec2(p.x, o.y + v), 0).rgb * basis(v, xy.y);
  }
  float rg = uResidualGain * (hash12(vec2(anchor) + 4.9) < uResBloomFrac ? uResBloom : 1.0);
  ycc += rg * res;

  // Each partition's colour slowly walks in its own seeded Cb/Cr direction.
  vec2 dir = vec2(hash12(vec2(anchor) + 8.3), hash12(vec2(anchor) + 9.7)) * 2.0 - 1.0;
  ycc.yz += uDcDrift * s.b * dir;

  vec3 col = ycc2rgb(ycc);
  // Half floats would freeze repeated sub-pel blends into bands; dither the write.
  if (melt) col += (hash12(vec2(p) + uPhase.xy * 97.0) - 0.5) / 1024.0;
  fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
