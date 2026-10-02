// The background's own motion, one texel per 16x16 macroblock: a pyramidal
// (coarse-to-fine) Lucas-Kanade estimate on luma between the previous and
// current source frames.
//   rg = motion (internal px per step, the direction the content moves), b = speed.
// Only a starting point: search.frag uses it as a predictor for the encoder's
// motion search, whose result is the vector every later pass uses.
//
// The pyramid is the source targets' own mip chain. At level L an 8x8 sample
// window with 2^L px spacing (2 px at level 0) is centred on the block, so the
// coarsest level sees 64 px and can lock onto motion of several pixels per
// step; each finer level refines the warped estimate from the one above.
uniform sampler2D uCur;
uniform sampler2D uPrev;
uniform float uFlowEps;

const int LEVELS = 4;
const int ITERS = 2;

vec2 texSize;

float luma(sampler2D t, vec2 p, float lod) {
  return dot(textureLod(t, p / texSize, lod).rgb, vec3(0.299, 0.587, 0.114));
}

void main() {
  texSize = vec2(textureSize(uCur, 0));
  vec2 c = (floor(gl_FragCoord.xy) + 0.5) * float(MB);
  vec2 v = vec2(0.0);

  for (int L = LEVELS - 1; L >= 0; L--) {
    float lod = float(L);
    float s = exp2(lod);           // level pixel, in internal px
    float d = max(s, 2.0);         // sample spacing
    vec2 ex = vec2(s, 0.0);
    vec2 ey = vec2(0.0, s);

    for (int it = 0; it < ITERS; it++) {
      // Gradients come from the current frame only, so the system is the
      // same each iteration; only the warped temporal difference changes.
      float xx = 0.0, xy = 0.0, yy = 0.0, xt = 0.0, yt = 0.0;
      for (int j = 0; j < 8; j++) {
        for (int i = 0; i < 8; i++) {
          vec2 p = c + (vec2(i, j) - 3.5) * d;
          float ix = (luma(uCur, p + ex, lod) - luma(uCur, p - ex, lod)) / (2.0 * s);
          float iy = (luma(uCur, p + ey, lod) - luma(uCur, p - ey, lod)) / (2.0 * s);
          float itm = luma(uCur, p, lod) - luma(uPrev, p - v, lod);
          xx += ix * ix;
          xy += ix * iy;
          yy += iy * iy;
          xt += ix * itm;
          yt += iy * itm;
        }
      }

      // Regularised so flat, featureless blocks read as still rather than
      // noise. Gradients shrink by 1/s per level, so eps scales by 1/s^2.
      float eps = uFlowEps / (s * s);
      xx += eps;
      yy += eps;
      vec2 dv = -vec2(yy * xt - xy * yt, xx * yt - xy * xt) / (xx * yy - xy * xy);
      // Keep each update within the level's linear range.
      float m = length(dv);
      if (m > 1.5 * s) dv *= 1.5 * s / m;
      v += dv;
    }
  }

  fragColor = vec4(v, length(v), 1.0);
}
