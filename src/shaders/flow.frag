// The background's own motion, one texel per 16x16 macroblock: a Lucas-Kanade
// estimate on luma between the previous and current source frames.
//   rg = motion (internal px per step, the direction the content moves), b = speed.
// This is the vector an honest encoder would find; where it is strong, the
// encoder would refresh the block and wash any mosh out of it.
uniform sampler2D uCur;
uniform sampler2D uPrev;
uniform float uFlowEps;

float luma(sampler2D t, ivec2 p, ivec2 size) {
  return dot(texelFetch(t, clamp(p, ivec2(0), size - 1), 0).rgb, vec3(0.299, 0.587, 0.114));
}

void main() {
  ivec2 size = textureSize(uCur, 0);
  ivec2 o = ivec2(gl_FragCoord.xy) * MB;
  const ivec2 dx = ivec2(1, 0);
  const ivec2 dy = ivec2(0, 1);

  float xx = 0.0, xy = 0.0, yy = 0.0, xt = 0.0, yt = 0.0;
  for (int y = 0; y < MB; y += 2) {
    for (int x = 0; x < MB; x += 2) {
      ivec2 p = o + ivec2(x, y);
      float ix = 0.25 * (luma(uCur, p + dx, size) - luma(uCur, p - dx, size)
                       + luma(uPrev, p + dx, size) - luma(uPrev, p - dx, size));
      float iy = 0.25 * (luma(uCur, p + dy, size) - luma(uCur, p - dy, size)
                       + luma(uPrev, p + dy, size) - luma(uPrev, p - dy, size));
      float it = luma(uCur, p, size) - luma(uPrev, p, size);
      xx += ix * ix;
      xy += ix * iy;
      yy += iy * iy;
      xt += ix * it;
      yt += iy * it;
    }
  }

  // Regularised so flat, featureless blocks read as still rather than noise.
  xx += uFlowEps;
  yy += uFlowEps;
  vec2 v = -vec2(yy * xt - xy * yt, xx * yt - xy * xt) / (xx * yy - xy * xy);

  fragColor = vec4(v, length(v), 1.0);
}
