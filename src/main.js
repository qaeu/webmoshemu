import './style.css';
import * as THREE from 'three';

const app = document.querySelector('#app');

app.innerHTML = `
  <div class="hud">
    <h1>WebMoshemu</h1>
    <p>Move your cursor to intensify datamosh artifacts.</p>
  </div>
`;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
app.appendChild(renderer.domElement);

const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const sourceCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

const fsScene = new THREE.Scene();
const sourceScene = new THREE.Scene();

const mouse = new THREE.Vector2(0.5, 0.5);
const mouseVelocity = new THREE.Vector2(0, 0);
const smoothVelocity = new THREE.Vector2(0, 0);
const resolution = new THREE.Vector2(window.innerWidth, window.innerHeight);

// ── Source: domain-warped FBM fractal background ──────────────────────────────
const sourceMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uTime: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: `
    varying vec2 vUv;
    uniform float uTime;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    float noise(vec2 p) {
      vec2 i = floor(p);
      vec2 f = fract(p);
      vec2 u = f * f * (3.0 - 2.0 * f);
      return mix(
        mix(hash(i),               hash(i + vec2(1.0, 0.0)), u.x),
        mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
        u.y
      );
    }

    // 6-octave FBM with a slight rotation each octave for more variation
    float fbm(vec2 p) {
      float v   = 0.0;
      float amp = 0.5;
      mat2  rot = mat2(0.80, -0.60, 0.60, 0.80);
      for (int i = 0; i < 6; i++) {
        v  += amp * noise(p);
        p   = rot * p * 2.1;
        amp *= 0.48;
      }
      return v;
    }

    void main() {
      vec2 p = vUv * 3.5;
      float t = uTime * 0.04;

      // Two layers of domain-warping for organic fractal feel
      vec2 q = vec2(fbm(p + t),
                    fbm(p + vec2(5.2, 1.3) + t * 0.9));
      vec2 r = vec2(fbm(p + 4.0 * q + vec2(1.7, 9.2) + t * 0.6),
                    fbm(p + 4.0 * q + vec2(8.3, 2.8) + t * 0.5));
      float f = fbm(p + 4.0 * r);

      // Soft, dark palette: near-black indigo → dark slate → muted teal
      vec3 col = mix(
        mix(vec3(0.04, 0.03, 0.10), vec3(0.07, 0.13, 0.20), clamp(f * 1.8, 0.0, 1.0)),
        vec3(0.06, 0.20, 0.18),
        clamp(f * f * 2.5, 0.0, 1.0)
      );
      // Very faint luminous highlight on the brightest ridges
      col += 0.04 * vec3(0.3, 0.6, 1.0) * clamp(f - 0.5, 0.0, 1.0);

      gl_FragColor = vec4(col, 1.0);
    }
  `,
});

sourceScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), sourceMaterial));

const sourceRT = new THREE.WebGLRenderTarget(1, 1, {
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  format: THREE.RGBAFormat,
  type: THREE.UnsignedByteType,
});
const feedbackA = sourceRT.clone();
const feedbackB = sourceRT.clone();

let readRT = feedbackA;
let writeRT = feedbackB;

// ── Process: realistic macroblock datamosh ────────────────────────────────────
const processMaterial = new THREE.ShaderMaterial({
  uniforms: {
    uSource:        { value: sourceRT.texture },
    uPrev:          { value: readRT.texture },
    uResolution:    { value: resolution.clone() },
    uTime:          { value: 0 },
    uMouseVelocity: { value: 0.0 },
    uBlockSize:     { value: 16.0 },
    uMoshStrength:  { value: 0.022 },
    uPersistence:   { value: 0.93 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position.xy, 0.0, 1.0);
    }
  `,
  fragmentShader: `
    varying vec2 vUv;
    uniform sampler2D uSource;
    uniform sampler2D uPrev;
    uniform vec2  uResolution;
    uniform float uTime;
    uniform float uMouseVelocity;
    uniform float uBlockSize;
    uniform float uMoshStrength;
    uniform float uPersistence;

    float hash(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
    }

    // Smooth, spatially coherent motion field — mimics real motion estimation.
    // All pixels inside the same macroblock share the same motion vector.
    vec2 blockMotionVec(vec2 blockCoord) {
      vec2 nc = blockCoord / (uResolution / uBlockSize); // normalise to [0,1]
      float ang =
          sin(uTime * 0.31 + nc.x * 4.2  + nc.y * 3.1)
        + sin(uTime * 0.17 + nc.x * 2.1  - nc.y * 5.3) * 0.5
        + sin(uTime * 0.09 - nc.x * 6.7  + nc.y * 2.8) * 0.25;
      float mag = cos(uTime * 0.23 + nc.x * 3.7 + nc.y * 2.9) * 0.5 + 0.5;
      return vec2(cos(ang), sin(ang)) * mag * uMoshStrength;
    }

    // Simulate DCT block quantisation: YCbCr with luma getting more bits
    // than chroma, matching real codec behaviour.
    vec3 dctQuantize(vec3 rgb) {
      float y  =  dot(rgb, vec3( 0.299,  0.587,  0.114));
      float cb =  dot(rgb, vec3(-0.169, -0.331,  0.500)) + 0.5;
      float cr =  dot(rgb, vec3( 0.500, -0.419, -0.081)) + 0.5;
      y  = floor(y  * 24.0) / 24.0;
      cb = floor(cb * 12.0) / 12.0;
      cr = floor(cr * 12.0) / 12.0;
      cb -= 0.5; cr -= 0.5;
      return clamp(vec3(
        y + 1.402  * cr,
        y - 0.344  * cb - 0.714 * cr,
        y + 1.772  * cb
      ), 0.0, 1.0);
    }

    void main() {
      vec2 uv = vUv;

      // ── Macroblock grid ──────────────────────────────────────────────────
      vec2 bs          = vec2(uBlockSize) / uResolution;   // block size in UV
      vec2 blockCoord  = floor(uv / bs);                   // integer block index
      vec2 blockOrigin = blockCoord * bs;                  // top-left UV of block
      vec2 localUv     = uv - blockOrigin;                 // pixel-within-block offset

      // ── Per-block motion vector (same for every pixel in the block) ──────
      vec2 mv = blockMotionVec(blockCoord);

      // Where to sample in the *previous* frame: shift the whole block by mv,
      // then add back the local intra-block offset so we copy actual texture
      // content rather than a flat colour.
      vec2 prevOrigin = clamp(blockOrigin - mv, vec2(0.0), vec2(1.0) - bs);
      vec2 prevUv     = clamp(prevOrigin + localUv, 0.0, 1.0);

      // ── Source (I-frame equivalent) and previous (P-frame reference) ────
      vec3 src  = texture2D(uSource, uv).rgb;
      vec3 prev = dctQuantize(texture2D(uPrev, prevUv).rgb);

      // ── Autonomous GOP cycle (I-frame drops every ~7 s) ─────────────────
      // pFrameWeight ≈ 0 at the start of each cycle (brief I-frame refresh),
      // rising to 1 for the rest of the GOP (P-frames, corruption accumulates).
      float gopPhase    = fract(uTime / 7.0);
      float pFrameWeight = smoothstep(0.0, 0.07, gopPhase);

      // ── Mouse velocity boosts corruption during fast cursor movement ─────
      float velBoost = uMouseVelocity * 0.55;
      float moshAmt  = clamp(
        uPersistence * pFrameWeight + velBoost * (1.0 - pFrameWeight * 0.4),
        0.0, 0.97
      );

      gl_FragColor = vec4(mix(src, prev, moshAmt), 1.0);
    }
  `,
});

fsScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), processMaterial));

function resize() {
  const width  = window.innerWidth;
  const height = window.innerHeight;

  renderer.setSize(width, height);
  resolution.set(width, height);
  processMaterial.uniforms.uResolution.value.set(width, height);

  sourceRT.setSize(width, height);
  feedbackA.setSize(width, height);
  feedbackB.setSize(width, height);
}

window.addEventListener('resize', resize);
window.addEventListener('pointermove', (event) => {
  const x = event.clientX / window.innerWidth;
  const y = 1.0 - event.clientY / window.innerHeight;
  mouseVelocity.x += x - mouse.x;
  mouseVelocity.y += y - mouse.y;
  mouse.set(x, y);
});

resize();

const clock = new THREE.Clock();

function frame() {
  requestAnimationFrame(frame);

  const time = clock.getElapsedTime();
  sourceMaterial.uniforms.uTime.value = time;
  processMaterial.uniforms.uTime.value = time;

  // Smooth velocity → normalise to a 0-1 corruption boost
  smoothVelocity.lerp(mouseVelocity, 0.15);
  processMaterial.uniforms.uMouseVelocity.value =
    Math.min(smoothVelocity.length() * 50.0, 1.0);
  mouseVelocity.set(0, 0);

  processMaterial.uniforms.uSource.value = sourceRT.texture;
  processMaterial.uniforms.uPrev.value   = readRT.texture;

  renderer.setRenderTarget(sourceRT);
  renderer.render(sourceScene, sourceCamera);

  renderer.setRenderTarget(writeRT);
  renderer.render(fsScene, orthoCamera);

  processMaterial.uniforms.uPrev.value = writeRT.texture;
  renderer.setRenderTarget(null);
  renderer.render(fsScene, orthoCamera);

  const temp = readRT;
  readRT  = writeRT;
  writeRT = temp;
}

frame();
