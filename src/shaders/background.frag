// Slow, domain-warped dusk field with drifting contour lines. The contours
// give the mosh something to tear; the smooth fill keeps it calm.
in vec2 vUv;
uniform float uTime;
uniform vec2 uSize;

vec2 grad(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453);
}
float gnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(dot(grad(i), f), dot(grad(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0)), u.x),
    mix(dot(grad(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0)), dot(grad(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0)), u.x),
    u.y
  );
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  mat2 r = mat2(0.8, -0.6, 0.6, 0.8);
  for (int i = 0; i < 4; i++) {
    s += a * gnoise(p);
    p = r * p * 2.03;
    a *= 0.5;
  }
  return s;
}

vec3 dusk(float x) {
  x = clamp(x, 0.0, 1.0);
  vec3 c = vec3(0.027, 0.043, 0.133);                                   // #070b22
  c = mix(c, vec3(0.106, 0.078, 0.275), smoothstep(0.00, 0.25, x));     // #1b1446
  c = mix(c, vec3(0.290, 0.122, 0.388), smoothstep(0.22, 0.45, x));     // #4a1f63
  c = mix(c, vec3(0.635, 0.231, 0.420), smoothstep(0.42, 0.62, x));     // #a23b6b
  c = mix(c, vec3(1.000, 0.478, 0.271), smoothstep(0.60, 0.80, x));     // #ff7a45
  c = mix(c, vec3(1.000, 0.816, 0.541), smoothstep(0.78, 0.95, x));     // #ffd08a
  return c;
}

void main() {
  vec2 p = (vUv - 0.5) * uSize / min(uSize.x, uSize.y);
  float t = uTime;

  vec2 q = vec2(fbm(p * 0.8 + vec2(0.0, t * 0.03)), fbm(p * 0.8 + vec2(5.2, -t * 0.025)));
  vec2 r = vec2(
    fbm(p * 0.7 + 1.4 * q + vec2(1.7, 9.2) + t * 0.018),
    fbm(p * 0.7 + 1.4 * q + vec2(8.3, 2.8) - t * 0.022)
  );
  float f = fbm(p * 0.6 + 1.5 * r);

  float v = 0.42 + 0.95 * f - 0.38 * (vUv.y - 0.5);

  // A soft low sun drifting slowly across the lower third.
  vec2 sun = vec2(0.28 * sin(t * 0.021), -0.18 + 0.05 * sin(t * 0.017));
  float glow = exp(-2.4 * length(p - sun));
  v += 0.22 * glow;

  vec3 col = dusk(v);

  // Thin luminous iso-lines that flow through the field.
  float x = v * 6.0 - t * 0.04;
  float d = min(fract(x), 1.0 - fract(x));
  float line = 1.0 - smoothstep(0.0, fwidth(x) * 1.3, d);
  col += line * 0.12 * mix(vec3(0.55, 0.45, 1.0), vec3(1.0, 0.85, 0.6), smoothstep(0.3, 0.8, v));

  col += glow * 0.08 * vec3(1.0, 0.55, 0.3);

  vec2 e = vUv - 0.5;
  col *= 1.0 - 0.55 * dot(e, e);

  // Alpha 0: a clean frame carries no mosh (ref's alpha, see reconstruct.frag).
  fragColor = vec4(col, 0.0);
}
