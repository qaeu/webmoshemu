// Inter blocks are shown with nearest sampling so the block copies stay crisp;
// clean blocks use the filtered source so the background stays smooth.
in vec2 vUv;
uniform sampler2D uRef;
uniform sampler2D uCur;
uniform sampler2D uState;

void main() {
  ivec2 size = textureSize(uRef, 0);
  ivec2 p = clamp(ivec2(vUv * vec2(size)), ivec2(0), size - 1);
  vec3 col = isInter(texelFetch(uState, p / MB, 0))
    ? texelFetch(uRef, p, 0).rgb
    : texture(uCur, vUv).rgb;
  col += (hash12(gl_FragCoord.xy) - 0.5) / 255.0;
  fragColor = vec4(col, 1.0);
}
