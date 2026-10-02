// out = MC(previous decoded frame, mv) + IDCT(Q(residual)) for inter blocks,
// the clean source for intra blocks. Luma is copied per partition at
// integer-pel; chroma is predicted on the 4:2:0 grid in 2px steps. Vectors are
// rounded with a per-step dither shared by every block, so sub-pixel motion
// (the slow background drift) advances in whole-pixel jumps at the right
// average rate instead of rounding to zero or blurring through interpolation.
//
// Melted blocks (state.r, latched in blocks.frag) instead predict at sub-pel
// with a Catmull-Rom bicubic, so content smears as it travels; an unsplit
// melted block also interpolates its vector between neighbouring sub-blocks,
// so it curls rather than sliding rigidly. Melted pixels also drift in colour:
// chroma lags the pointer's offset and partitions pick up a seeded Cb/Cr
// bias. Near-healed 8x8 partitions drip their neighbour's edge into
// themselves, and a share of inter partitions over-apply their residual.
//
// Alpha carries the mosh itself: how far above healing each pixel is (its
// block's heat minus its threshold when it was moshed). Cold pixels decode
// as an honest P-block would, with the background's own vector: if what that
// fetches is moshed, the mosh travels on with the scene into the cold block,
// losing margin wherever the background moves fast, as heat does; otherwise
// the pixel is the clean source. With the true vector an honest encoder's
// residual is next to nothing, so carried mosh gets none (the coded residual
// is the zero-vector one, which would count the motion twice).
uniform sampler2D uRef;
uniform sampler2D uCur;
uniform sampler2D uTmp;    // row-inverted coefficients from idctRows.frag
uniform sampler2D uState;
uniform sampler2D uSub;    // linear filtered; texelFetch everywhere but warp
uniform sampler2D uFlow;
uniform float uResidualGain;
uniform vec4 uPhase;       // xy = luma rounding dither, zw = chroma
uniform float uChromaLag;  // chroma's share of the pointer offset (melt only)
uniform float uDcDrift;    // per-step Cb/Cr bias at full heat (melt only)
uniform float uResBloomFrac;
uniform float uResBloom;   // residual gain on that share of partitions
uniform float uSmear;      // edge blend at the partition's source edge
uniform float uSmearBand;  // heat above threshold where 8x8 partitions smear
uniform vec2 uHealSpeed;   // as in blocks.frag, for mosh carried out of hot blocks
uniform float uHealRate;

vec4 catmullRom(float t) {
  float t2 = t * t;
  float t3 = t2 * t;
  return vec4(-0.5 * t3 + t2 - 0.5 * t,
              1.5 * t3 - 2.5 * t2 + 1.0,
             -1.5 * t3 + 2.0 * t2 + 0.5 * t,
              0.5 * t3 - 0.5 * t2);
}

// YCbCr of the previous decoded frame at a sub-pixel position (pixel centres
// at i + 0.5). Repeated every step, any interpolation averages neighbouring
// hues towards a muddy brown-grey, so the chroma's strength is reset to the
// weighted mean strength of the taps: hues still blend, saturation holds, and
// it can never exceed its neighbours'.
vec3 refCubic(vec2 pos, ivec2 size) {
  vec2 q = pos - 0.5;
  ivec2 i0 = ivec2(floor(q));
  vec2 f = q - vec2(i0);
  vec4 wx = catmullRom(f.x);
  vec4 wy = catmullRom(f.y);
  vec3 acc = vec3(0.0);
  float mag = 0.0;
  float wsum = 0.0;
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      vec3 c = rgb2ycc(texelFetch(uRef, clamp(i0 + ivec2(i - 1, j - 1), ivec2(0), size - 1), 0).rgb);
      float w = wx[i] * wy[j];
      acc += w * c;
      mag += abs(w) * length(c.yz);
      wsum += abs(w);
    }
  }
  float l = length(acc.yz);
  if (l > 1e-4) acc.yz *= min(mag / wsum / l, 2.0);
  return acc;
}

void main() {
  ivec2 p = ivec2(gl_FragCoord.xy);
  vec4 s = texelFetch(uState, p / MB, 0);
  vec4 sub = texelFetch(uSub, p / SB, 0);
  ivec2 size = textureSize(uRef, 0);
  vec3 fl = texelFetch(uFlow, p / MB, 0).rgb;
  vec2 flow = fl.rg;
  bool inter = isInterAt(s, sub, p);
  float margin = s.b - interThreshold(groupSeed(s, sub, p));
  if (!inter) {
    ivec2 mv = ivec2(floor(-flow + uPhase.xy));
    margin = texelFetch(uRef, clamp(p + mv, ivec2(0), size - 1), 0).a
           - uHealRate * smoothstep(uHealSpeed.x, uHealSpeed.y, fl.b);
    if (margin <= 0.0) {
      fragColor = vec4(texelFetch(uCur, p, 0).rgb, 0.0);
      return;
    }
  }
  // Carried mosh has no pointer offset and none of the hot-block extras.
  vec2 off = inter ? sub.rg : vec2(0.0);
  ivec2 anchor = groupAnchor(sub.b, p / SB);
  bool melt = inter && s.r > 0.5;

  vec3 ycc;
  if (melt) {
    // Warp: interpolate between sub-block offsets, but only where the block
    // is unsplit, so partition edges survive.
    if (sub.b < 0.5) off = texture(uSub, (vec2(p) + 0.5) / vec2(size)).rg;
    vec2 v = off - flow;
    vec2 vc = off * uChromaLag - flow;
    ycc.x = refCubic(vec2(p) + 0.5 + v, size).x;
    ycc.yz = refCubic(vec2(p) + 0.5 + vc, size).yz;
  } else {
    vec2 v = off - flow;
    ivec2 mv = ivec2(floor(v + uPhase.xy));
    ycc.x = rgb2ycc(texelFetch(uRef, clamp(p + mv, ivec2(0), size - 1), 0).rgb).x;

    ivec2 mvc = ivec2(floor(v * 0.5 + uPhase.zw)) * 2;
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
  if (inter && sub.b > 2.5 && s.b < interThreshold(groupSeed(s, sub, p)) + uSmearBand) {
    ivec2 sb0 = (p / SB) * SB;
    bool horiz = hash12(vec2(anchor) + 5.3) < 0.5;
    ivec2 src = horiz ? ivec2(sb0.x - 1, p.y) : ivec2(p.x, sb0.y + SB);
    float d = horiz ? float(p.x - sb0.x) : float(sb0.y + SB - 1 - p.y);
    ivec2 mv = ivec2(floor(sub.rg - flow + uPhase.xy));
    vec3 edge = rgb2ycc(texelFetch(uRef, clamp(src + mv, ivec2(0), size - 1), 0).rgb);
    ycc = mix(ycc, edge, uSmear * (1.0 - d / float(SB)));
  }

  if (inter) {
    ivec2 o = (p / 8) * 8;
    ivec2 xy = p - o;
    vec3 res = vec3(0.0);
    for (int v = 0; v < 8; v++) {
      res += texelFetch(uTmp, ivec2(p.x, o.y + v), 0).rgb * basis(v, xy.y);
    }
    float rg = uResidualGain * (hash12(vec2(anchor) + 4.9) < uResBloomFrac ? uResBloom : 1.0);
    ycc += rg * res;
  }
  if (melt) {
    // Each melted partition's colour slowly walks in its own seeded Cb/Cr direction.
    vec2 dir = vec2(hash12(vec2(anchor) + 8.3), hash12(vec2(anchor) + 9.7)) * 2.0 - 1.0;
    ycc.yz += uDcDrift * s.b * dir;
  }

  vec3 col = ycc2rgb(ycc);
  // Half floats would freeze repeated sub-pel blends into bands; dither the write.
  if (melt) col += (hash12(vec2(p) + uPhase.xy * 97.0) - 0.5) / 1024.0;
  // Floored so a barely-hot pixel still reads as moshed in half float.
  fragColor = vec4(clamp(col, 0.0, 1.0), max(margin, 1e-3));
}
