// Moshed pixels (ref alpha > 0: hot blocks and mosh carried out of them) are
// shown with nearest sampling so the block copies stay crisp; clean pixels use
// the filtered source so the background stays smooth.
// With the debug overlay on, the pointer mask is shaded translucent black, each
// partition group in it gets a white arrow for the direction its content moves
// (-mv, since mv is a fetch offset), and inter blocks show their partition
// edges.
in vec2 vUv;
uniform sampler2D uRef;
uniform sampler2D uCur;
uniform sampler2D uState;
uniform sampler2D uSub;
uniform sampler2D uFlow;
uniform sampler2D uMask;
uniform bool uDebug;

float segment(vec2 p, vec2 a, vec2 b) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  return length(pa - ba * clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0));
}

// Coverage of a motion arrow in internal px, anchored at the block centre.
// aa = internal px per screen px.
float arrow(vec2 p, vec2 c, vec2 v, float aa) {
  float len = length(v);
  float lw = 0.35 + 0.5 * aa;
  if (len < 0.75) return 1.0 - smoothstep(1.0, 1.0 + aa, length(p - c));
  vec2 dir = v / len;
  vec2 tip = c + v;
  float head = min(3.0, 0.5 * len);
  vec2 back = tip - dir * head;
  vec2 side = vec2(-dir.y, dir.x) * head * 0.6;
  float d = min(segment(p, c, tip), min(segment(p, tip, back + side), segment(p, tip, back - side)));
  return 1.0 - smoothstep(lw, lw + aa, d);
}

void main() {
  ivec2 size = textureSize(uRef, 0);
  ivec2 p = clamp(ivec2(vUv * vec2(size)), ivec2(0), size - 1);
  vec4 s = texelFetch(uState, p / MB, 0);
  vec4 sub = texelFetch(uSub, p / SB, 0);
  vec2 pf = vUv * vec2(size);
  float aa = fwidth(pf.x);
  bool inter = isInterAt(s, sub, p);
  vec4 r = texelFetch(uRef, p, 0);
  vec3 col = r.a > 0.0 ? r.rgb : texture(uCur, vUv).rgb;
  if (uDebug) {
    float w = texelFetch(uMask, p / MB, 0).r;
    col *= 1.0 - 0.6 * w;
    if (w > 0.0) {
      int code = int(sub.b + 0.5);
      if (inter) {
        // 1 px partition edges through the macroblock's middle.
        vec2 mid = (vec2(p / MB) + 0.5) * float(MB);
        float e = 1.0;
        if (code == 2 || code == 3) e = min(e, abs(pf.x - mid.x) / aa);
        if (code == 1 || code == 3) e = min(e, abs(pf.y - mid.y) / aa);
        col = mix(col, vec3(1.0), 0.5 * (1.0 - smoothstep(0.5, 1.0, e)));
      }
      // Doubled for legibility, capped to stay inside the group.
      vec2 ext = vec2(groupExtent(sub.b));
      vec2 v = -pixelMv(sub, texelFetch(uFlow, p / MB, 0)) * 2.0;
      float l = length(v);
      float cap = 0.45 * min(ext.x, ext.y);
      if (l > cap) v *= cap / l;
      vec2 c = vec2(groupAnchor(sub.b, p / SB) * SB) + 0.5 * ext;
      col = mix(col, vec3(1.0), 0.9 * arrow(pf, c, v, aa));
    }
  }
  col += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  fragColor = vec4(col, 1.0);
}
