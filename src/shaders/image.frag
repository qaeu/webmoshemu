// A dropped still image painted over the decoded frame, cover-cropped like
// video.frag. It is written to ref, not to a source target: the current
// source keeps playing, and its motion vectors and residuals carry the image
// along until intra blocks replace it. The texture is mipmapped, so one
// trilinear tap is enough for the downscale.
in vec2 vUv;
uniform sampler2D uImage;
uniform vec2 uSize;      // internal px
uniform vec2 uImageSize; // image px

void main() {
  float a = uSize.x / uSize.y;
  float ia = uImageSize.x / uImageSize.y;
  vec2 scale = ia > a ? vec2(a / ia, 1.0) : vec2(1.0, ia / a);
  vec3 c = texture(uImage, 0.5 + (vUv - 0.5) * scale).rgb;

  // Alpha 1: every pixel is moshed (see reconstruct.frag), and like every
  // moshed write it is rounded to a grid RGBA16F holds exactly.
  fragColor = vec4(floor(c * 2048.0 + 0.5) / 2048.0, 1.0);
}
