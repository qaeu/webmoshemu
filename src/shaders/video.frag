// A dropped video as the source frame, cover-cropped (centred, no distortion)
// into the internal frame. Video textures have no mipmaps, so a 2x2 bilinear
// footprint softens the downscale enough to keep the flow estimate from
// locking onto aliasing.
in vec2 vUv;
uniform sampler2D uVideo;
uniform vec2 uSize;      // internal px
uniform vec2 uVideoSize; // video px

void main() {
  float a = uSize.x / uSize.y;
  float va = uVideoSize.x / uVideoSize.y;
  vec2 scale = va > a ? vec2(a / va, 1.0) : vec2(1.0, va / a);
  vec2 uv = 0.5 + (vUv - 0.5) * scale;

  // Quarter of an internal pixel, in video uv.
  vec2 o = 0.25 * scale / uSize;
  vec3 c = texture(uVideo, uv + vec2(-o.x, -o.y)).rgb
         + texture(uVideo, uv + vec2(o.x, -o.y)).rgb
         + texture(uVideo, uv + vec2(-o.x, o.y)).rgb
         + texture(uVideo, uv + vec2(o.x, o.y)).rgb;

  fragColor = vec4(0.25 * c, 1.0);
}
