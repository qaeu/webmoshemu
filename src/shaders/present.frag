// Inter blocks are shown with nearest sampling so the block copies stay crisp;
// clean blocks use the filtered source so the background stays smooth.
// With the debug overlay on, the pointer mask is shaded translucent black and
// each masked block gets a white arrow for the direction its content moves
// (-mv, since mv is a fetch offset).
in vec2 vUv;
uniform sampler2D uRef;
uniform sampler2D uCur;
uniform sampler2D uState;
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
  vec2 pf = vUv * vec2(size);
  float aa = fwidth(pf.x);
  vec3 col = isInter(s)
    ? texelFetch(uRef, p, 0).rgb
    : texture(uCur, vUv).rgb;
  if (uDebug) {
    float w = texelFetch(uMask, p / MB, 0).r;
    col *= 1.0 - 0.6 * w;
    if (w > 0.0) {
      // Doubled for legibility, capped to stay inside the block.
      vec2 v = -blockMv(s, texelFetch(uFlow, p / MB, 0)) * 2.0;
      float l = length(v);
      if (l > 0.45 * float(MB)) v *= 0.45 * float(MB) / l;
      vec2 c = (vec2(p / MB) + 0.5) * float(MB);
      col = mix(col, vec3(1.0), 0.9 * arrow(pf, c, v, aa));
    }
  }
  col += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  fragColor = vec4(col, 1.0);
}
