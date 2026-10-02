/**
 * Tuning constants. Every value is per decoded frame and deliberately not
 * rate-scaled; only the pointer's smoothing, velocity clamp and
 * {@link params.speedRef} are scaled by `k = dt / STEP` in the decoder.
 *
 * @module
 */
import * as THREE from 'three';

// ── Tuning ───────────────────────────────────────────────────────────────────
// The decoder runs at a fixed, macroblock-aligned internal resolution so block
// size stays a constant fraction of the screen on every device.

/** Short side of the internal decoder resolution, in px. */
export const SHORT_SIDE = 384;
/** Macroblock size in px; the long side is rounded to a multiple of this. */
export const MB = 16;
/** Sub-block (8×8 partition and DCT block) size in px. */
export const SB = 8;
/**
 * Procedural source step duration in seconds (60 Hz), and the reference step
 * that rate-scaled values are expressed against. Video sources step once per
 * video frame instead.
 */
export const STEP = 1 / 60;
/** Quantiser parameter, H.264 style: the step size doubles every 6. */
const QP = 28;

/** Decoder tuning, passed to the shaders as uniforms by `createPasses()`. */
export const params = {
  /** Radius of the pointer's zone mask and vortex, in internal px. */
  radius: 6.4 * MB,
  /** Tangential (swirl) strength of the pointer vortex, in px per step. */
  swirl: 2.2,
  /** Steady inward drain of the vortex: fetching from further out pulls fresh blocks in from the rim. */
  inflow: 0.9,
  /** Amplitude of the slow travelling oscillation added to {@link params.inflow}. */
  breath: 0.5,
  /** Pointer speed (internal px per step) at which the effect is at full strength. */
  speedRef: 8,
  /**
   * Per-step decay of the pointer's vector offset. Every block's vector is that
   * offset on top of the background's measured motion, which is never relaxed.
   */
  mvRelax: 0.055,
  /**
   * 8x8 partitions: how much each sub-block's target follows its own vortex
   * position (vs. the macroblock's).
   */
  subShear: 1,
  /** 8x8 partitions: the seeded twist applied to each sub-block's target. */
  subTwist: 0.8,
  /**
   * Rate-distortion lambda range for choosing a partition (px^2 per extra
   * vector; low splits more readily), picked per block by its seed.
   */
  lamLo: 0.15,
  /** Upper end of the lambda range; see {@link params.lamLo}. */
  lamHi: 1.2,
  /** Bloom: the share of macroblocks whose pointer offset relaxes much slower. */
  bloomFrac: 0.3,
  /** Bloom: factor applied to {@link params.mvRelax} on blooming macroblocks. */
  bloomRelax: 0.15,
  /**
   * Melt: inter blocks whose offset passes this many px may switch to bicubic
   * sub-pel motion compensation (warped per pixel when unsplit).
   */
  meltMv: 5.5,
  /** Melt: the seeded share of eligible blocks that actually melt. */
  meltFrac: 0.3,
  /** Rim smear: how strongly 8x8 partitions near healing drip their neighbour's edge in. */
  smear: 0.6,
  /** Rim smear: the heat band above the healing threshold where smear applies. */
  smearBand: 0.08,
  /** Colour drift on melted pixels: chroma's share of the pointer offset. */
  chromaLag: 0.85,
  /** Colour drift on melted pixels: seeded per-step Cb/Cr bias at full heat. */
  dcDrift: 0.0008,
  /** Share of inter partitions whose residual is over-applied. */
  resBloomFrac: 0.1,
  /** Residual gain on those partitions; see {@link params.resBloomFrac}. */
  resBloom: 2,
  /** Zone mask: spatial scale of the drifting simplex noise, in internal px. */
  noiseScale: 5 * MB,
  /** Zone mask: drift speed of the noise. The mask is a soft disc minus noise scaled to 0..0.5. */
  noiseSpeed: 0.12,
  /**
   * Regulariser for the pyramidal Lucas–Kanade solve in `flow.frag`, so flat,
   * featureless blocks read as still rather than noise.
   */
  flowEps: 2e-4,
  /**
   * Healing: heat only drains where the background itself moves fast. Flow
   * speed (internal px per step) ramps healing in from `x` to `y`.
   */
  healSpeed: new THREE.Vector2(0.3, 16.0),
  /** Healing: heat removed per step at full background speed. */
  healRate: 0.01,
  /** DCT quantiser step on 0..1 values, derived from {@link QP}. */
  qstep: (0.625 * 2 ** (QP / 6)) / 255,
};

/** The shape of {@link params}. */
export type Params = typeof params;
