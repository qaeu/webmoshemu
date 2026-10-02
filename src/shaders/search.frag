// The encoder's motion search, one texel per 16x16 macroblock:
//   rg = the block's motion (internal px per step, the direction the content
//   moves; the fetch offset is -rg), b = speed.
// This is the background vector every later pass uses: blocks.frag tests it
// against intra, the residual is coded against it, and reconstruct adds the
// pointer's offset to it.
//
// Lucas-Kanade (flow.frag) alone tops out around 15 px/step and goes wrong on
// fast rotation, where an encoder testing only its vector finds nothing and
// codes the whole frame intra. Real encoders search instead (x264's predictive
// search, EPZS): try the vectors the block is likely to have (its own and its
// neighbours' Lucas-Kanade estimates, last step's result here and around it,
// zero), search a window around the best on the quarter-resolution mip, refine
// it pixel by pixel at full resolution, then add a sub-pixel correction.
// Because last step's vectors are candidates, a rotation that speeds up
// gradually is followed to any speed; the coarse window covers sudden jumps
// up to uSearchRange px.
//
// Costs are luma SADs on half the block's pixels (a quincunx of 64), at the
// same rounding as an unrestricted-MV fetch: off-frame positions clamp to the
// edge.
uniform sampler2D uCur;
uniform sampler2D uPrev;
uniform sampler2D uLk;     // Lucas-Kanade estimates (flow.frag)
uniform sampler2D uLast;   // last step's search result
uniform float uSearchRange; // coarse window radius, px
uniform float uFlowEps;    // as in flow.frag, for the sub-pixel step

ivec2 size;
ivec2 o;
vec2 texSize;
float cy[64];

float lumaAt(sampler2D t, ivec2 p) {
  return dot(texelFetch(t, clamp(p, ivec2(0), size - 1), 0).rgb, vec3(0.299, 0.587, 0.114));
}

float lumaLod(sampler2D t, vec2 p, float lod) {
  return dot(textureLod(t, p / texSize, lod).rgb, vec3(0.299, 0.587, 0.114));
}

ivec2 sampleAt(int i) {
  int y = i >> 3;
  return o + ivec2(2 * (i & 7) + (y & 1), 2 * y);
}

// SAD of the block against the previous frame, content moved by m.
float cost(vec2 m) {
  ivec2 d = ivec2(floor(-m + 0.5));
  float e = 0.0;
  for (int i = 0; i < 64; i++) {
    e += abs(cy[i] - lumaAt(uPrev, sampleAt(i) + d));
  }
  return e;
}

void main() {
  ivec2 b = ivec2(gl_FragCoord.xy);
  size = textureSize(uCur, 0);
  texSize = vec2(size);
  o = b * MB;
  ivec2 nb = size / MB;
  for (int i = 0; i < 64; i++) cy[i] = lumaAt(uCur, sampleAt(i));

  // Predictors. Ties keep the earlier candidate, so flat blocks keep their
  // Lucas-Kanade vector rather than a random match.
  vec2 best = texelFetch(uLk, b, 0).rg;
  float bestCost = cost(best);
  vec2 cand[10];
  cand[0] = texelFetch(uLast, b, 0).rg;
  cand[1] = vec2(0.0);
  for (int k = 0; k < 4; k++) {
    ivec2 d = k == 0 ? ivec2(1, 0) : k == 1 ? ivec2(-1, 0) : k == 2 ? ivec2(0, 1) : ivec2(0, -1);
    ivec2 q = clamp(b + d, ivec2(0), nb - 1);
    cand[2 + k] = texelFetch(uLk, q, 0).rg;
    cand[6 + k] = texelFetch(uLast, q, 0).rg;
  }
  for (int k = 0; k < 10; k++) {
    float e = cost(cand[k]);
    if (e < bestCost) {
      bestCost = e;
      best = cand[k];
    }
  }

  // Coarse window on mip level 2 (4 px texels): a 4x4 sample of the block.
  {
    vec2 c = (vec2(b) + 0.5) * float(MB);
    float cc[16];
    for (int i = 0; i < 16; i++) {
      cc[i] = lumaLod(uCur, c + (vec2(i & 3, i >> 2) - 1.5) * 4.0, 2.0);
    }
    int r = int(uSearchRange / 4.0);
    vec2 cBest = best;
    float cBestCost = 1e9;
    for (int y = -r; y <= r; y++) {
      for (int x = -r; x <= r; x++) {
        vec2 m = best + vec2(x, y) * 4.0;
        float e = 0.0;
        for (int i = 0; i < 16; i++) {
          e += abs(cc[i] - lumaLod(uPrev, c + (vec2(i & 3, i >> 2) - 1.5) * 4.0 - m, 2.0));
        }
        if (e < cBestCost) {
          cBestCost = e;
          cBest = m;
        }
      }
    }
    float e = cost(cBest);
    if (e < bestCost) {
      bestCost = e;
      best = cBest;
    }
  }

  // Full-resolution refinement: a 2 px then 1 px diamond, keeping the
  // vector's fraction.
  float step = 2.0;
  for (int it = 0; it < 10; it++) {
    vec2 m = best;
    for (int k = 0; k < 4; k++) {
      vec2 d = k == 0 ? vec2(1, 0) : k == 1 ? vec2(-1, 0) : k == 2 ? vec2(0, 1) : vec2(0, -1);
      float e = cost(best + d * step);
      if (e < bestCost) {
        bestCost = e;
        m = best + d * step;
      }
    }
    if (m == best) {
      if (step < 1.5) break;
      step = 1.0;
    }
    best = m;
  }

  // Sub-pixel: one Lucas-Kanade step at full resolution, warped by the match.
  {
    vec2 c = (vec2(b) + 0.5) * float(MB);
    vec2 ex = vec2(1.0, 0.0);
    vec2 ey = vec2(0.0, 1.0);
    float xx = 0.0, xy = 0.0, yy = 0.0, xt = 0.0, yt = 0.0;
    for (int j = 0; j < 8; j++) {
      for (int i = 0; i < 8; i++) {
        vec2 p = c + (vec2(i, j) - 3.5) * 2.0;
        float ix = 0.5 * (lumaLod(uCur, p + ex, 0.0) - lumaLod(uCur, p - ex, 0.0));
        float iy = 0.5 * (lumaLod(uCur, p + ey, 0.0) - lumaLod(uCur, p - ey, 0.0));
        float itm = lumaLod(uCur, p, 0.0) - lumaLod(uPrev, p - best, 0.0);
        xx += ix * ix;
        xy += ix * iy;
        yy += iy * iy;
        xt += ix * itm;
        yt += iy * itm;
      }
    }
    xx += uFlowEps;
    yy += uFlowEps;
    vec2 dv = -vec2(yy * xt - xy * yt, xx * yt - xy * xt) / (xx * yy - xy * xy);
    best += clamp(dv, vec2(-0.75), vec2(0.75));
  }

  fragColor = vec4(best, length(best), 1.0);
}
