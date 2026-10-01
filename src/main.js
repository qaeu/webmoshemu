import './style.css';
import * as THREE from 'three';

import common from './shaders/common.glsl?raw';
import quadVert from './shaders/quad.vert?raw';
import backgroundFrag from './shaders/background.frag?raw';
import videoFrag from './shaders/video.frag?raw';
import flowFrag from './shaders/flow.frag?raw';
import maskFrag from './shaders/mask.frag?raw';
import blocksFrag from './shaders/blocks.frag?raw';
import subFrag from './shaders/sub.frag?raw';
import dctRowsFrag from './shaders/dctRows.frag?raw';
import dctColsFrag from './shaders/dctCols.frag?raw';
import idctRowsFrag from './shaders/idctRows.frag?raw';
import reconstructFrag from './shaders/reconstruct.frag?raw';
import presentFrag from './shaders/present.frag?raw';

// ── Tuning ───────────────────────────────────────────────────────────────────
// The decoder runs at a fixed, macroblock-aligned internal resolution so block
// size stays a constant fraction of the screen on every device.
const SHORT_SIDE = 384;
const MB = 16;
const SB = 8;
// Procedural source rate; video sources step once per video frame instead.
const STEP = 1 / 60;
const QP = 28;

const params = {
  radius: 6.4 * MB,
  swirl: 2.2,
  inflow: 0.9,
  breath: 0.5,
  // Pointer speed (internal px per step) at which the effect is at full strength.
  speedRef: 8,
  // Per-step decay of the pointer's vector offset. Every block's vector is that
  // offset on top of the background's measured motion, which is never relaxed.
  mvRelax: 0.055,
  // 8x8 partitions: how much each sub-block's target follows its own vortex
  // position (vs. the macroblock's), its seeded twist, and the rate-distortion
  // lambda range (px^2 per extra vector; low splits more readily).
  subShear: 1,
  subTwist: 0.8,
  lamLo: 0.15,
  lamHi: 1.2,
  // Bloom: a share of macroblocks whose pointer offset relaxes much slower.
  bloomFrac: 0.3,
  bloomRelax: 0.15,
  // Melt: a share of inter blocks whose offset passes meltMv px switch to
  // bilinear motion compensation (warped per pixel when unsplit).
  meltMv: 2.5,
  meltFrac: 0.3,
  // Rim smear: 8x8 partitions within smearBand heat of healing drip their
  // neighbour's edge in.
  smear: 0.6,
  smearBand: 0.08,
  // Colour drift on inter pixels: chroma's share of the pointer offset, a
  // seeded per-step Cb/Cr bias at full heat, and residual over-application.
  chromaLag: 0.85,
  dcDrift: 0.0015,
  resBloomFrac: 0.1,
  resBloom: 2,
  // Zone mask: a soft disc minus drifting simplex noise scaled to 0..0.5.
  noiseScale: 5 * MB,
  noiseSpeed: 0.12,
  // Healing: heat only drains where the background itself moves fast
  // (pyramidal Lucas-Kanade speed in internal px per step, ramping from x to y).
  flowEps: 2e-4,
  healSpeed: new THREE.Vector2(0.3, 16.0),
  healRate: 0.01,
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
const videoPass = pass(videoFrag, {
  uVideo: { value: null },
  uSize: { value: new THREE.Vector2() },
  uVideoSize: { value: new THREE.Vector2() },
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
  uSub: { value: null },
  uFlow: { value: null },
  uMask: { value: null },
  uVelocity: { value: new THREE.Vector2() },
  uSpeedRef: { value: params.speedRef },
  uHealSpeed: { value: params.healSpeed },
  uHealRate: { value: params.healRate },
  uCut: { value: 0 },
  uMeltMv: { value: params.meltMv },
  uMeltFrac: { value: params.meltFrac },
});
const subPass = pass(subFrag, {
  uSub: { value: null },
  uState: { value: null },
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
  uSubShear: { value: params.subShear },
  uSubTwist: { value: params.subTwist },
  uLamLo: { value: params.lamLo },
  uLamHi: { value: params.lamHi },
  uBloomFrac: { value: params.bloomFrac },
  uBloomRelax: { value: params.bloomRelax },
});
const dctRowsPass = pass(dctRowsFrag, {
  uCur: { value: null },
  uPrev: { value: null },
  uState: { value: null },
  uSub: { value: null },
});
const dctColsPass = pass(dctColsFrag, {
  uTmp: { value: null },
  uState: { value: null },
  uSub: { value: null },
  uQstep: { value: params.qstep },
});
const idctRowsPass = pass(idctRowsFrag, {
  uCoef: { value: null },
  uState: { value: null },
  uSub: { value: null },
});
const reconstructPass = pass(reconstructFrag, {
  uRef: { value: null },
  uCur: { value: null },
  uTmp: { value: null },
  uState: { value: null },
  uSub: { value: null },
  uFlow: { value: null },
  uResidualGain: { value: 1 },
  uPhase: { value: new THREE.Vector4() },
  uChromaLag: { value: params.chromaLag },
  uDcDrift: { value: params.dcDrift },
  uResBloomFrac: { value: params.resBloomFrac },
  uResBloom: { value: params.resBloom },
  uSmear: { value: params.smear },
  uSmearBand: { value: params.smearBand },
});
const presentPass = pass(presentFrag, {
  uRef: { value: null },
  uCur: { value: null },
  uState: { value: null },
  uSub: { value: null },
  uFlow: { value: null },
  uMask: { value: null },
  uDebug: { value: false },
});

// ── Render targets (RGBA16F: renderable on iOS, unlike 32-bit float) ────────
function target(w, h, filter = THREE.NearestFilter, mipmaps = false) {
  return new THREE.WebGLRenderTarget(w, h, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: mipmaps ? THREE.LinearMipmapLinearFilter : filter,
    magFilter: filter,
    generateMipmaps: mipmaps,
    depthBuffer: false,
  });
}

let size = { w: 0, h: 0 };
let src, state, sub, ref, coef, tmp, flow, mask;

function allocate() {
  const aspect = window.innerWidth / window.innerHeight;
  const align = (v) => Math.max(MB, Math.round(v / MB) * MB);
  const w = aspect >= 1 ? align(SHORT_SIDE * aspect) : SHORT_SIDE;
  const h = aspect >= 1 ? SHORT_SIDE : align(SHORT_SIDE / aspect);
  if (w === size.w && h === size.h) return;

  [src, state, sub, ref, coef, tmp, flow, mask].flat().filter(Boolean).forEach((rt) => rt.dispose());

  size = { w, h };
  pointer.last = null;
  // Source frames carry a mip chain: the image pyramid for flow.frag.
  src = [target(w, h, THREE.LinearFilter, true), target(w, h, THREE.LinearFilter, true)];
  state = [target(w / MB, h / MB), target(w / MB, h / MB)];
  // Linear for the bilinear fetches in reconstruct's melt path only; every
  // other read is texelFetch, which ignores filtering.
  sub = [target(w / SB, h / SB, THREE.LinearFilter), target(w / SB, h / SB, THREE.LinearFilter)];
  ref = [target(w, h, THREE.LinearFilter), target(w, h, THREE.LinearFilter)];
  coef = target(w, h);
  // Separable DCT intermediate, shared by the forward and inverse transforms.
  tmp = target(w, h);
  flow = target(w / MB, h / MB);
  mask = target(w / MB, h / MB);
  backgroundPass.uniforms.uSize.value.set(w, h);
  videoPass.uniforms.uSize.value.set(w, h);

  // Start clean: zero block state, and a first source frame to diff against.
  for (const rt of [...state, ...sub]) {
    renderer.setRenderTarget(rt);
    renderer.clear();
  }
  source.draw(src[1]);
  source.draw(ref[0]);
}

function draw(material, rt) {
  quad.material = material;
  renderer.setRenderTarget(rt);
  renderer.render(scene, camera);
}

// ── Sources ──────────────────────────────────────────────────────────────────
// A source supplies the clean frames the decoder encodes. The decoder steps
// once per source frame:
//   draw(rt)   render the current frame into rt
//   poll(now)  durations (s) of the frames due this display frame, if any
//   dispose()
const procedural = {
  last: performance.now(),
  acc: 0,
  draw(rt) {
    backgroundPass.uniforms.uTime.value = time;
    draw(backgroundPass, rt);
  },
  // Fixed 60 Hz, at most two steps per display frame.
  poll(now) {
    this.acc += Math.min((now - this.last) / 1000, 0.1);
    this.last = now;
    const due = [];
    while (this.acc >= STEP && due.length < 2) {
      due.push(STEP);
      this.acc -= STEP;
    }
    if (this.acc > STEP) this.acc = 0;
    return due;
  },
  dispose() {},
};

// A video file, stepped at its own frame rate (one step per presented frame).
// Resolves once the first frame is decodable; rejects if it can't be played.
function videoSource(file) {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.src = url;

  const texture = new THREE.VideoTexture(video);
  // The pipeline works on display-encoded values, like the procedural source.
  texture.colorSpace = THREE.NoColorSpace;

  const hasRvfc = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
  let callback = 0;
  let pending = null; // media time of the newest unconsumed frame
  let last = null;
  let dt = 1 / 30;

  const self = {
    draw(rt) {
      videoPass.uniforms.uVideo.value = texture;
      videoPass.uniforms.uVideoSize.value.set(video.videoWidth, video.videoHeight);
      draw(videoPass, rt);
    },
    poll() {
      if (!hasRvfc && !video.paused && video.currentTime !== last) pending = video.currentTime;
      if (pending === null) return [];
      const d = pending - last;
      // Variable frame rate is fine; a loop wrap (d < 0) reuses the last duration.
      if (d > 0) dt = Math.min(Math.max(d, 1 / 120), 1 / 10);
      last = pending;
      pending = null;
      return [dt];
    },
    dispose() {
      if (hasRvfc) video.cancelVideoFrameCallback(callback);
      video.pause();
      video.removeAttribute('src');
      video.load();
      texture.dispose();
      URL.revokeObjectURL(url);
    },
  };

  return new Promise((resolve, reject) => {
    const onFrame = (_, meta) => {
      if (last === null) {
        // The first frame becomes the starting reference, not a step.
        last = meta.mediaTime;
        resolve(self);
      } else {
        pending = meta.mediaTime;
      }
      callback = video.requestVideoFrameCallback(onFrame);
    };
    const fail = (err) => {
      if (last !== null) return; // already playing; later errors just stall it
      self.dispose();
      reject(err);
    };
    video.addEventListener('error', () => fail(video.error), { once: true });
    if (hasRvfc) {
      callback = video.requestVideoFrameCallback(onFrame);
    } else {
      video.addEventListener('loadeddata', () => {
        last = video.currentTime;
        resolve(self);
      }, { once: true });
    }
    video.play().catch(fail);
  });
}

let source = procedural;

// Swap sources like a datamosh cut with the new clip's I-frame removed: the
// decoder keeps its last decoded frame as the reference, the next step forces
// every block inter, and the new footage's residuals and motion then play out
// over the old picture until its own motion heals it. The new frame becomes
// `prev` so the first step sees no motion or residual across the cut.
let cutPending = false;

function setSource(next) {
  source.dispose();
  source = next;
  source.draw(src[1]);
  cutPending = true;
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

function step(dt) {
  time += dt;
  frameNo++;
  debug.steps++;

  // Tuning is per decoded frame, but the pointer's smoothing and speed
  // reference are scaled by frame duration so it feels the same at any rate.
  const k = dt / STEP;
  pointer.velocity.lerp(pointer.delta, 1 - 0.5 ** k);
  pointer.delta.set(0, 0);
  pointer.active += (pointer.target - pointer.active) * (1 - 0.92 ** k);

  // 1. New source frame.
  source.draw(src[0]);
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

  // 4. Macroblock heat and melt latch.
  const velocity = pointer.velocity.clone().clampLength(0, 20 * k);
  const bu = blocksPass.uniforms;
  bu.uState.value = state[0].texture;
  bu.uSub.value = sub[0].texture;
  bu.uFlow.value = flow.texture;
  bu.uMask.value = mask.texture;
  bu.uVelocity.value.copy(velocity);
  bu.uSpeedRef.value = params.speedRef * k;
  bu.uCut.value = cutPending ? 1 : 0;
  cutPending = false;
  draw(blocksPass, state[1]);
  state.reverse();

  // 5. Sub-block vectors and partitions.
  const su = subPass.uniforms;
  su.uSub.value = sub[0].texture;
  su.uState.value = state[0].texture;
  su.uMask.value = mask.texture;
  su.uPointer.value.copy(pointer.pos);
  su.uVelocity.value.copy(velocity);
  su.uSpeedRef.value = params.speedRef * k;
  su.uTime.value = time;
  draw(subPass, sub[1]);
  sub.reverse();

  // 6. Quantised residual of the source (separable DCT: rows, then columns),
  // and the first half of its inverse.
  const dr = dctRowsPass.uniforms;
  dr.uCur.value = cur.texture;
  dr.uPrev.value = prev.texture;
  dr.uState.value = state[0].texture;
  dr.uSub.value = sub[0].texture;
  draw(dctRowsPass, tmp);
  const dc = dctColsPass.uniforms;
  dc.uTmp.value = tmp.texture;
  dc.uState.value = state[0].texture;
  dc.uSub.value = sub[0].texture;
  draw(dctColsPass, coef);
  const ir = idctRowsPass.uniforms;
  ir.uCoef.value = coef.texture;
  ir.uState.value = state[0].texture;
  ir.uSub.value = sub[0].texture;
  draw(idctRowsPass, tmp);

  // 7. Reconstruct against the (wrong) previous decoded frame.
  const cu = reconstructPass.uniforms;
  cu.uRef.value = ref[0].texture;
  cu.uCur.value = cur.texture;
  cu.uTmp.value = tmp.texture;
  cu.uState.value = state[0].texture;
  cu.uSub.value = sub[0].texture;
  cu.uFlow.value = flow.texture;
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
  pu.uSub.value = sub[0].texture;
  pu.uFlow.value = flow.texture;
  pu.uMask.value = mask.texture;
  pu.uDebug.value = debug.on;
  draw(presentPass, null);
}

// ── Debug overlay ('d'): fps readout plus the pointer mask shaded black ─────
const debug = { on: false, frames: 0, steps: 0, since: performance.now(), el: document.createElement('div') };
debug.el.className = 'fps';
debug.el.hidden = true;
document.body.appendChild(debug.el);

window.addEventListener('keydown', (e) => {
  if (e.key !== 'd' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
  debug.on = !debug.on;
  debug.el.hidden = !debug.on;
  debug.frames = 0;
  debug.steps = 0;
  debug.since = performance.now();
});

function countFrame(now) {
  if (!debug.on) return;
  debug.frames++;
  if (now - debug.since >= 500) {
    const rate = (n) => Math.round((n * 1000) / (now - debug.since));
    debug.el.textContent = `${rate(debug.frames)} fps · ${rate(debug.steps)} dec`;
    debug.frames = 0;
    debug.steps = 0;
    debug.since = now;
  }
}

function resize() {
  renderer.setSize(window.innerWidth, window.innerHeight);
  allocate();
}
window.addEventListener('resize', resize);
resize();

// ── Drag and drop a video file to replace the background ────────────────────
let drags = 0;
let dropId = 0;
const hasFiles = (e) => e.dataTransfer?.types.includes('Files');

window.addEventListener('dragenter', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  if (drags++ === 0) document.body.classList.add('dragging');
});
window.addEventListener('dragleave', () => {
  if (drags && --drags === 0) document.body.classList.remove('dragging');
});
window.addEventListener('dragover', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  e.dataTransfer.dropEffect = 'copy';
});
window.addEventListener('drop', async (e) => {
  e.preventDefault();
  drags = 0;
  document.body.classList.remove('dragging');
  const file = [...(e.dataTransfer?.files ?? [])].find((f) => f.type.startsWith('video/'));
  if (!file) return;
  const id = ++dropId;
  try {
    const next = await videoSource(file);
    // A later drop superseded this one while it was loading.
    if (id !== dropId) next.dispose();
    else setSource(next);
  } catch (err) {
    console.warn(`Can't play ${file.name}:`, err);
  }
});

function frame(now) {
  requestAnimationFrame(frame);
  countFrame(now);
  const due = source.poll(now);
  for (const dt of due) step(dt);
  if (due.length) present();
}

requestAnimationFrame(frame);
