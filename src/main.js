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
// Accumulated raw UV-delta per frame; zeroed each frame after use.
const mouseVelocity = new THREE.Vector2(0, 0);
// Smoothed velocity in UV-units-per-second (exponential decay, frame-rate independent).
const smoothVelocity = new THREE.Vector2(0, 0);
const resolution = new THREE.Vector2(window.innerWidth, window.innerHeight);
let prevFrameTime = 0;

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
      vec2 p = vUv * 5.0;
      float t = uTime * 0.05;

      // Two layers of domain-warping for organic fractal feel.
      vec2 q = vec2(fbm(p + t),
                    fbm(p + vec2(5.2, 1.3) + t * 0.9));
      vec2 r = vec2(fbm(p + 2.0 * q + vec2(1.7, 9.2) + t * 0.6),
                    fbm(p + 2.0 * q + vec2(8.3, 2.8) + t * 0.5));
      float f = fbm(p + 2.0 * r);

      // 7-stop smooth gradient: deep navy → violet → magenta → cobalt-blue → teal → amber → sage
      vec3 c0 = vec3(0.02, 0.02, 0.18);  // deep navy-indigo
      vec3 c1 = vec3(0.07, 0.03, 0.25);  // rich violet
      vec3 c2 = vec3(0.20, 0.03, 0.15);  // deep magenta
      vec3 c3 = vec3(0.03, 0.14, 0.28);  // dark cobalt-blue
      vec3 c4 = vec3(0.02, 0.20, 0.20);  // dark teal
      vec3 c5 = vec3(0.18, 0.12, 0.02);  // deep amber
      vec3 c6 = vec3(0.10, 0.22, 0.10);  // dark sage-green

      vec3 col = mix(c0, c1, smoothstep(0.00, 0.18, f));
      col      = mix(col, c2, smoothstep(0.15, 0.32, f));
      col      = mix(col, c3, smoothstep(0.28, 0.46, f));
      col      = mix(col, c4, smoothstep(0.42, 0.58, f));
      col      = mix(col, c5, smoothstep(0.54, 0.72, f));
      col      = mix(col, c6, smoothstep(0.68, 0.90, f));

      // Glowing accents on the brightest ridges
      col += 0.05 * vec3(0.2, 0.7, 1.0) * smoothstep(0.50, 0.80, f);
      col += 0.03 * vec3(0.7, 0.3, 1.0) * smoothstep(0.75, 1.00, f);

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
    uMouse:         { value: mouse },
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
    uniform vec2  uMouse;
    uniform float uMouseVelocity;
    uniform float uBlockSize;
    uniform float uMoshStrength;
    uniform float uPersistence;

    // Smooth, spatially coherent motion field — mimics real motion estimation.
    // All pixels inside the same macroblock share the same motion vector.
    // Use blockCoord scaled by a fixed constant so the field is resolution-independent
    // (no jump when the window is resized).
    vec2 blockMotionVec(vec2 blockCoord) {
      vec2 nc = blockCoord * 0.008;
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

      // ── Proximity to cursor: mosh effect is localised around the cursor ──
      // Account for aspect ratio so the radius is circular on screen.
      float aspect    = uResolution.x / uResolution.y;
      vec2  toMouse   = (uv - uMouse) * vec2(aspect, 1.0);
      float dist      = length(toMouse);
      // radius ~0.073 of screen height; beyond that the effect fades to zero.
      float proximity = 1.0 - smoothstep(0.0, 0.073, dist);

      // Inside cursor: sample from motion-displaced prev (full mosh effect).
      // Outside cursor: sample from the same UV in prev (no displacement), so
      // moshed colours retain their hue at their screen positions rather than
      // drifting with the synthetic motion field — emulating standard P-frames
      // that follow moshed P-frames in a real codec.
      vec2 sampleUv   = mix(uv, prevUv, proximity);

      // ── Source and previous frame (P-frame only — no periodic I-frame reset) ──
      vec3 src        = texture2D(uSource, uv).rgb;
      vec4 prevSample = texture2D(uPrev, sampleUv);
      vec3 prev       = prevSample.rgb;
      // Alpha channel stores the "has been moshed" flag (0 = pristine, 1 = moshed).
      float prevMoshed = prevSample.a;

      // Mark pixel as moshed while cursor is near; outside the cursor the flag
      // never decays so moshed colours persist indefinitely.
      float inCursor   = step(0.05, proximity);
      float moshedFlag = clamp(prevMoshed + inCursor, 0.0, 1.0);

      // ── Persistence strategy ─────────────────────────────────────────────
      // Pristine pixels (prevMoshed ≈ 0): reset to source each frame (basePersist = 0).
      // Previously-moshed pixels (prevMoshed ≈ 1): maintain with high persistence so
      // their colours survive after the cursor leaves; the flag decays at ~1 %/frame
      // outside the cursor so they gradually dissolve back into the source.
      float velBoost    = uMouseVelocity * 0.8 * proximity;
      float basePersist = prevMoshed;                // keeps moshed state alive indefinitely
      float moshAmt     = clamp(
        max(basePersist, uPersistence * proximity) + velBoost,
        0.0, 0.97
      );

      // Apply DCT-style quantisation to the final blended result once, matching
      // how a real codec quantises each encoded frame rather than re-quantising
      // an already-quantised feedback sample on every pass.
      gl_FragColor = vec4(dctQuantize(mix(src, prev, moshAmt)), moshedFlag);
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
const FRAME_MS = 1000 / 30; // target 30 fps
let lastFrameMs = 0;

function frame(timestamp) {
  requestAnimationFrame(frame);

  // Throttle to 30 fps; skip if the browser fired the callback too early.
  if (timestamp - lastFrameMs < FRAME_MS) return;
  lastFrameMs = timestamp;

  const time = clock.getElapsedTime();
  // Delta time in seconds, clamped to avoid a huge spike on the first frame.
  const dt = Math.min(time - prevFrameTime, 0.1);
  prevFrameTime = time;

  sourceMaterial.uniforms.uTime.value = time;
  processMaterial.uniforms.uTime.value = time;

  // Convert accumulated frame delta to UV/sec, then smooth with a
  // time-constant that is independent of frame rate (exponential decay).
  const alpha = 1.0 - Math.exp(-10.0 * dt);
  const velPerSec = mouseVelocity.clone().divideScalar(Math.max(dt, 1e-4));
  smoothVelocity.lerp(velPerSec, alpha);
  processMaterial.uniforms.uMouseVelocity.value =
    Math.min(smoothVelocity.length() * 0.12, 1.0);
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

requestAnimationFrame(frame);
