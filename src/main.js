import './style.css';
import * as THREE from 'three';

import common from './shaders/common.glsl?raw';
import quadVert from './shaders/quad.vert?raw';
import backgroundFrag from './shaders/background.frag?raw';
import blocksFrag from './shaders/blocks.frag?raw';
import residualFrag from './shaders/residual.frag?raw';
import reconstructFrag from './shaders/reconstruct.frag?raw';
import presentFrag from './shaders/present.frag?raw';

// ── Tuning ───────────────────────────────────────────────────────────────────
// The decoder runs at a fixed, macroblock-aligned internal resolution so block
// size stays a constant fraction of the screen on every device.
const SHORT_SIDE = 384;
const MB = 16;
const STEP = 1 / 60;
const QP = 28;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const params = {
  radius: 8 * MB,
  swirl: reducedMotion ? 1.0 : 2.2,
  inflow: 0.9,
  breath: 0.5,
  heatDecay: 0.992,
  mvDecay: 0.985,
  qstep: (0.625 * 2 ** (QP / 6)) / 255,
};

// ── Renderer ─────────────────────────────────────────────────────────────────
const app = document.querySelector('#app');
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.autoClear = false;
app.appendChild(renderer.domElement);

const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
const scene = new THREE.Scene();
const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
scene.add(quad);

const basis = Array.from({ length: 64 }, (_, i) => {
  const k = Math.floor(i / 8);
  const x = i % 8;
  return (k === 0 ? Math.SQRT1_2 : 1) * 0.5 * Math.cos(((2 * x + 1) * k * Math.PI) / 16);
});

function pass(fragmentShader, uniforms) {
  return new THREE.ShaderMaterial({
    glslVersion: THREE.GLSL3,
    vertexShader: quadVert,
    fragmentShader: `${common}\n${fragmentShader}`,
    uniforms: { uBasis: { value: basis }, ...uniforms },
    depthTest: false,
    depthWrite: false,
  });
}

const backgroundPass = pass(backgroundFrag, {
  uTime: { value: 0 },
  uSize: { value: new THREE.Vector2() },
});
const blocksPass = pass(blocksFrag, {
  uState: { value: null },
  uPointer: { value: new THREE.Vector2() },
  uVelocity: { value: new THREE.Vector2() },
  uActive: { value: 0 },
  uRadius: { value: params.radius },
  uTime: { value: 0 },
  uSwirl: { value: params.swirl },
  uBreath: { value: params.breath },
  uInflow: { value: params.inflow },
  uHeatDecay: { value: params.heatDecay },
  uMvDecay: { value: params.mvDecay },
});
const residualPass = pass(residualFrag, {
  uCur: { value: null },
  uPrev: { value: null },
  uState: { value: null },
  uQstep: { value: params.qstep },
});
const reconstructPass = pass(reconstructFrag, {
  uRef: { value: null },
  uCur: { value: null },
  uCoef: { value: null },
  uState: { value: null },
  uResidualGain: { value: 1 },
});
const presentPass = pass(presentFrag, {
  uRef: { value: null },
  uCur: { value: null },
  uState: { value: null },
});

// ── Render targets (RGBA16F: renderable on iOS, unlike 32-bit float) ────────
function target(w, h, filter = THREE.NearestFilter) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: filter,
    magFilter: filter,
    depthBuffer: false,
  });
}

let size = { w: 0, h: 0 };
let src, state, ref, coef;

function allocate() {
  const aspect = window.innerWidth / window.innerHeight;
  const align = (v) => Math.max(MB, Math.round(v / MB) * MB);
  const w = aspect >= 1 ? align(SHORT_SIDE * aspect) : SHORT_SIDE;
  const h = aspect >= 1 ? SHORT_SIDE : align(SHORT_SIDE / aspect);
  if (w === size.w && h === size.h) return;

  [src, state, ref].flat().filter(Boolean).forEach((rt) => rt.dispose());
  coef?.dispose();

  size = { w, h };
  pointer.last = null;
  src = [target(w, h, THREE.LinearFilter), target(w, h, THREE.LinearFilter)];
  state = [target(w / MB, h / MB), target(w / MB, h / MB)];
  ref = [target(w, h), target(w, h)];
  coef = target(w, h);
  backgroundPass.uniforms.uSize.value.set(w, h);

  // Start clean: zero block state, and a first source frame to diff against.
  for (const rt of state) {
    renderer.setRenderTarget(rt);
    renderer.clear();
  }
  renderBackground(src[1], time);
  renderBackground(ref[0], time);
}

function draw(material, rt) {
  quad.material = material;
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
}

function renderBackground(rt, t) {
  backgroundPass.uniforms.uTime.value = t;
  draw(backgroundPass, rt);
}

// ── Pointer ──────────────────────────────────────────────────────────────────
const pointer = {
  pos: new THREE.Vector2(),
  last: null,
  delta: new THREE.Vector2(),
  velocity: new THREE.Vector2(),
  target: 0,
  active: 0,
  touched: false,
};

function toInternal(e) {
  return new THREE.Vector2(
    (e.clientX / window.innerWidth) * size.w,
    (1 - e.clientY / window.innerHeight) * size.h,
  );
}

function onPointer(e) {
  pointer.touched = true;
  pointer.target = 1;
  const samples = e.getCoalescedEvents?.() ?? [];
  for (const s of samples.length ? samples : [e]) {
    const p = toInternal(s);
    if (pointer.last) pointer.delta.add(p.clone().sub(pointer.last));
    pointer.last = p;
    pointer.pos.copy(p);
  }
}

function onRelease(e) {
  if (e.type === 'pointerleave' || e.pointerType !== 'mouse') {
    pointer.target = 0;
    pointer.last = null;
  }
}

const canvas = renderer.domElement;
canvas.addEventListener('pointerdown', (e) => {
  canvas.setPointerCapture(e.pointerId);
  pointer.last = null;
  onPointer(e);
});
canvas.addEventListener('pointermove', onPointer);
canvas.addEventListener('pointerup', onRelease);
canvas.addEventListener('pointercancel', onRelease);
canvas.addEventListener('pointerleave', onRelease);

// Until someone touches it, a slow drifting ghost pointer keeps the piece alive.
function autopilot(t) {
  const p = new THREE.Vector2(
    size.w * (0.5 + 0.28 * Math.sin(t * 0.23)),
    size.h * (0.5 + 0.22 * Math.sin(t * 0.31 + 1.2)),
  );
  if (pointer.last) pointer.delta.add(p.clone().sub(pointer.last));
  pointer.last = p;
  pointer.pos.copy(p);
  pointer.target = 1;
}

// ── Decoder step ─────────────────────────────────────────────────────────────
let time = 0;

function step() {
  time += STEP;
  if (!pointer.touched) autopilot(time);

  pointer.velocity.lerp(pointer.delta, 0.5);
  pointer.delta.set(0, 0);
  pointer.active += (pointer.target - pointer.active) * 0.08;

  // 1. Macroblock vectors + heat.
  const bu = blocksPass.uniforms;
  bu.uState.value = state[0].texture;
  bu.uPointer.value.copy(pointer.pos);
  bu.uVelocity.value.copy(pointer.velocity).clampLength(0, 20);
  bu.uActive.value = pointer.active;
  bu.uTime.value = time;
  draw(blocksPass, state[1]);
  state.reverse();

  // 2. New source frame.
  renderBackground(src[0], time);
  const [cur, prev] = src;

  // 3. Quantised residual of the source.
  const ru = residualPass.uniforms;
  ru.uCur.value = cur.texture;
  ru.uPrev.value = prev.texture;
  ru.uState.value = state[0].texture;
  draw(residualPass, coef);

  // 4. Reconstruct against the (wrong) previous decoded frame.
  const cu = reconstructPass.uniforms;
  cu.uRef.value = ref[0].texture;
  cu.uCur.value = cur.texture;
  cu.uCoef.value = coef.texture;
  cu.uState.value = state[0].texture;
  draw(reconstructPass, ref[1]);
  ref.reverse();

  src.reverse();
}

function present() {
  const pu = presentPass.uniforms;
  pu.uRef.value = ref[0].texture;
  pu.uCur.value = src[1].texture;
  pu.uState.value = state[0].texture;
  draw(presentPass, null);
}

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  allocate();
}
window.addEventListener('resize', resize);
resize();

let last = performance.now();
let acc = 0;

function frame(now) {
  requestAnimationFrame(frame);
  acc += Math.min((now - last) / 1000, 0.1);
  last = now;
  // Fixed-rate decode, at most two steps per display frame.
  let n = 0;
  while (acc >= STEP && n < 2) {
    step();
    acc -= STEP;
    n++;
  }
  if (acc > STEP) acc = 0;
  if (n) present();
}

requestAnimationFrame(frame);
