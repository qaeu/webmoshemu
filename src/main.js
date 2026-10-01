import './style.css';
import * as THREE from 'three';

import common from './shaders/common.glsl?raw';
import quadVert from './shaders/quad.vert?raw';
import backgroundFrag from './shaders/background.frag?raw';
import flowFrag from './shaders/flow.frag?raw';
import maskFrag from './shaders/mask.frag?raw';
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

const params = {
  radius: 6.4 * MB,
  swirl: 2.2,
  inflow: 0.9,
  breath: 0.5,
  // Pointer speed (internal px per step) at which the effect is at full strength.
  speedRef: 6,
  // Per-step pull of every vector towards the background's own motion.
  mvRelax: 0.015,
  // Zone mask: a soft disc minus drifting simplex noise scaled to 0..0.5.
  noiseScale: 5 * MB,
  noiseSpeed: 0.12,
  // Healing: heat only drains where the background itself moves fast
  // (Lucas-Kanade speed in internal px per step, ramping from x to y).
  flowEps: 2e-4,
  healSpeed: new THREE.Vector2(0.3, 0.9),
  healRate: 0.02,
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
const flowPass = pass(flowFrag, {
  uCur: { value: null },
  uPrev: { value: null },
  uFlowEps: { value: params.flowEps },
});
const maskPass = pass(maskFrag, {
  uPointer: { value: new THREE.Vector2() },
  uActive: { value: 0 },
  uRadius: { value: params.radius },
  uTime: { value: 0 },
  uNoiseScale: { value: params.noiseScale },
  uNoiseSpeed: { value: params.noiseSpeed },
});
const blocksPass = pass(blocksFrag, {
  uState: { value: null },
  uFlow: { value: null },
  uMask: { value: null },
  uPointer: { value: new THREE.Vector2() },
  uVelocity: { value: new THREE.Vector2() },
  uRadius: { value: params.radius },
  uTime: { value: 0 },
  uSwirl: { value: params.swirl },
  uBreath: { value: params.breath },
  uInflow: { value: params.inflow },
  uMvRelax: { value: params.mvRelax },
  uSpeedRef: { value: params.speedRef },
  uHealSpeed: { value: params.healSpeed },
  uHealRate: { value: params.healRate },
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
  uPhase: { value: new THREE.Vector4() },
});
const presentPass = pass(presentFrag, {
  uRef: { value: null },
  uCur: { value: null },
  uState: { value: null },
  uMask: { value: null },
  uDebug: { value: false },
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
let src, state, ref, coef, flow, mask;

function allocate() {
  const aspect = window.innerWidth / window.innerHeight;
  const align = (v) => Math.max(MB, Math.round(v / MB) * MB);
  const w = aspect >= 1 ? align(SHORT_SIDE * aspect) : SHORT_SIDE;
  const h = aspect >= 1 ? SHORT_SIDE : align(SHORT_SIDE / aspect);
  if (w === size.w && h === size.h) return;

  [src, state, ref].flat().filter(Boolean).forEach((rt) => rt.dispose());
  coef?.dispose();
  flow?.dispose();
  mask?.dispose();

  size = { w, h };
  pointer.last = null;
  src = [target(w, h, THREE.LinearFilter), target(w, h, THREE.LinearFilter)];
  state = [target(w / MB, h / MB), target(w / MB, h / MB)];
  ref = [target(w, h), target(w, h)];
  coef = target(w, h);
  flow = target(w / MB, h / MB);
  mask = target(w / MB, h / MB);
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
};

function toInternal(e) {
  return new THREE.Vector2(
    (e.clientX / window.innerWidth) * size.w,
    (1 - e.clientY / window.innerHeight) * size.h,
  );
}

function onPointer(e) {
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

// ── Decoder step ─────────────────────────────────────────────────────────────
let time = 0;
let frameNo = 0;

function step() {
  time += STEP;
  frameNo++;

  pointer.velocity.lerp(pointer.delta, 0.5);
  pointer.delta.set(0, 0);
  pointer.active += (pointer.target - pointer.active) * 0.08;

  // 1. New source frame.
  renderBackground(src[0], time);
  const [cur, prev] = src;

  // 2. The background's own motion vectors.
  flowPass.uniforms.uCur.value = cur.texture;
  flowPass.uniforms.uPrev.value = prev.texture;
  draw(flowPass, flow);

  // 3. Pointer zone mask.
  const mu = maskPass.uniforms;
  mu.uPointer.value.copy(pointer.pos);
  mu.uActive.value = pointer.active;
  mu.uTime.value = time;
  draw(maskPass, mask);

  // 4. Macroblock vectors + heat.
  const bu = blocksPass.uniforms;
  bu.uState.value = state[0].texture;
  bu.uFlow.value = flow.texture;
  bu.uMask.value = mask.texture;
  bu.uPointer.value.copy(pointer.pos);
  bu.uVelocity.value.copy(pointer.velocity).clampLength(0, 20);
  bu.uTime.value = time;
  draw(blocksPass, state[1]);
  state.reverse();

  // 5. Quantised residual of the source.
  const ru = residualPass.uniforms;
  ru.uCur.value = cur.texture;
  ru.uPrev.value = prev.texture;
  ru.uState.value = state[0].texture;
  draw(residualPass, coef);

  // 6. Reconstruct against the (wrong) previous decoded frame.
  const cu = reconstructPass.uniforms;
  cu.uRef.value = ref[0].texture;
  cu.uCur.value = cur.texture;
  cu.uCoef.value = coef.texture;
  cu.uState.value = state[0].texture;
  // Low-discrepancy (R2 / golden-ratio) rounding phases.
  cu.uPhase.value.set(
    (frameNo * 0.7548776662) % 1,
    (frameNo * 0.5698402910) % 1,
    (frameNo * 0.6180339887 + 0.5) % 1,
    (frameNo * 0.4142135624 + 0.5) % 1,
  );
  draw(reconstructPass, ref[1]);
  ref.reverse();

  src.reverse();
}

function present() {
  const pu = presentPass.uniforms;
  pu.uRef.value = ref[0].texture;
  pu.uCur.value = src[1].texture;
  pu.uState.value = state[0].texture;
  pu.uMask.value = mask.texture;
  pu.uDebug.value = debug.on;
  draw(presentPass, null);
}

// ── Debug overlay ('d'): fps readout plus the pointer mask shaded black ─────
const debug = { on: false, frames: 0, since: performance.now(), el: document.createElement('div') };
debug.el.className = 'fps';
debug.el.hidden = true;
document.body.appendChild(debug.el);

window.addEventListener('keydown', (e) => {
  if (e.key !== 'd' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  debug.on = !debug.on;
  debug.el.hidden = !debug.on;
  debug.frames = 0;
  debug.since = performance.now();
});

function countFrame(now) {
  if (!debug.on) return;
  debug.frames++;
  if (now - debug.since >= 500) {
    debug.el.textContent = `${Math.round((debug.frames * 1000) / (now - debug.since))} fps`;
    debug.frames = 0;
    debug.since = now;
  }
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
  countFrame(now);
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
