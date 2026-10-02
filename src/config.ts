/**
 * Tuning constants. Every value is per decoded frame and deliberately not
 * rate-scaled; only the pointer's smoothing, velocity clamp and
 * {@link params.speedRef} are scaled by `k = dt / STEP` in the decoder.
 *
 * @module
 */
// ── Tuning ───────────────────────────────────────────────────────────────────
// The decoder runs at a fixed, macroblock-aligned internal resolution so block
// size stays a constant fraction of the screen on every device.

/** Short side of the internal decoder resolution, in px. */
export const SHORT_SIDE = 512;
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

/**
 * Decoder tuning, passed to the shaders as uniforms by `createPasses()`.
 *
 * Units: "px" are internal decoder px (see {@link SHORT_SIDE}) and "step" is
 * one decoded frame. Every macroblock is inter-coded unless the encoder picks
 * intra for it (see {@link params.intraBias}); a pixel is moshed once the
 * pointer's offset starts it (see {@link params.mvOn}) or it fetches a moshed
 * pixel, and stays moshed until its block goes intra.
 * Vectors are fetch offsets: a pixel copies the previous decoded frame from
 * `p + mv`, so content moves opposite to the vector.
 */
export const params = {
  /**
   * Pointer zone and vortex radius, px. The zone mask is full strength within
   * `0.15 * radius` and fades to zero at `radius`; the vortex profile is
   * `sin(pi * r / radius)`, so it is zero at the pointer and the rim and
   * peaks at `radius / 2`.
   */
  radius: 6.4 * MB,
  /**
   * Tangential vortex offset, px, at the profile peak and full pointer speed.
   * The fetch is rotated counter-clockwise, so content turns clockwise.
   * Larger values swirl harder; offsets are clamped to 24 px in `sub.frag`.
   */
  swirl: 2.2,
  /**
   * Radial vortex offset, px, at the profile peak: blocks fetch from further
   * out, so content drains towards the pointer. Negative pushes outwards.
   */
  inflow: 0.9,
  /**
   * Amplitude, px, of an oscillation added to {@link params.inflow}:
   * `breath * sin(0.9 * t - 0.05 * r)`, a wave travelling outwards with a
   * period of about 7 s and a wavelength of about 126 px. 0 disables it.
   */
  breath: 0.5,
  /**
   * Smoothed pointer speed, px per step at 60 Hz, at which the pointer's
   * effect is at full strength. Vortex gain, drag and partition splitting
   * all scale with `min(speed / speedRef, 1)`, so a still pointer does
   * nothing. Lower makes slow strokes as strong as fast ones. Scaled by the
   * step duration, so it means the same at any source frame rate.
   */
  speedRef: 8,
  /**
   * Fraction of each partition's pointer offset removed per step, 0..1. The
   * offset's half-life is about `ln 2 / mvRelax` steps; lower makes swirls
   * persist after the pointer moves on. Only the pointer's offset relaxes:
   * the background's measured motion is added on top in full every step.
   */
  mvRelax: 0.055,
  /**
   * How far each 8x8 sub-block's vortex target is taken at its own centre
   * rather than its macroblock's, 0..1. 0 gives every sub-block the same
   * target, so macroblocks rarely split; 1 lets neighbouring sub-blocks differ
   * by the vortex's local gradient.
   */
  subShear: 1,
  /**
   * Seeded per-sub-block perturbation of the target, 0..1: a rotation of up
   * to `±1.1 * subTwist` rad and a gain of `1 ± 0.8 * subTwist`. Larger
   * values make sibling vectors disagree more, so macroblocks split into
   * 16x8 / 8x16 / 8x8 partitions more often.
   */
  subTwist: 0.8,
  /**
   * Lower bound of the rate-distortion lambda, px² of vector error per extra
   * vector. Each macroblock picks the partition shape minimising
   * `error + lambda * extraVectors` (0, 1, 1 or 3 extra), with lambda between
   * `lamLo` and `lamHi` by its seed. Lower lambda splits more readily.
   * Where zone strength times pointer speed gain is under 0.05 (outside the
   * zone, or a slow pointer), blocks are always 16x16.
   */
  lamLo: 0.15,
  /** Upper bound of the rate-distortion lambda; see {@link params.lamLo}. */
  lamHi: 1.2,
  /**
   * Seeded share of macroblocks, 0..1, whose pointer offset relaxes at
   * `mvRelax * bloomRelax` instead of `mvRelax`. These keep moving long after
   * their neighbours settle, like a duplicated P-frame.
   */
  bloomFrac: 0.35,
  /** Multiplier on {@link params.mvRelax} for blooming macroblocks; lower holds longer. */
  bloomRelax: 0.15,
  /**
   * Pointer offset, px, a partition needs before it starts moshing clean
   * pixels, scaled per partition by a seeded `1..2x` so the zone's edge is
   * ragged. Pixels that are already moshed use any offset. Also the offset
   * below which a melt latch clears.
   */
  mvOn: 0.75,
  /**
   * Pointer offset, px, that an inter macroblock's largest sub-block vector
   * must exceed before it can melt. Melted blocks use bicubic sub-pixel
   * motion compensation (content smears as it travels) and get the colour
   * drift below. The melt latches until the block's offsets relax below
   * {@link params.mvOn} or it goes intra.
   */
  meltMv: 5.5,
  /** Seeded share of macroblocks, 0..1, that melt once past {@link params.meltMv}. */
  meltFrac: 0.3,
  /**
   * Rim smear opacity, 0..1. A moshed 8x8 partition whose pointer offset is
   * under {@link params.smearMv} (the zone's fringe) blends in the decoded
   * edge just outside it (seeded: left column or row above), at `smear` on
   * that side fading linearly to 0 across the partition. Only blocks split
   * into four 8x8 partitions smear.
   */
  smear: 0.35,
  /** Pointer offset, px, below which 8x8 partitions smear; see {@link params.smear}. */
  smearMv: 1.5,
  /**
   * Melted pixels only: chroma is fetched with `chromaLag` times the
   * pointer offset while luma uses all of it, so below 1 colour trails the
   * swirl (above 1 it leads). 1 disables the lag.
   */
  chromaLag: 0.85,
  /**
   * Melted pixels only: a Cb/Cr bias added every step in a seeded
   * per-partition direction. It accumulates through the feedback loop,
   * so each melted partition drifts steadily towards its own hue.
   */
  dcDrift: 0.0008,
  /** Seeded share of moshed partitions, 0..1, whose residual is scaled by {@link params.resBloom}. */
  resBloomFrac: 0.1,
  /**
   * Residual gain on those partitions; 1 is normal. Above 1 the source's
   * frame-to-frame change is over-applied each step, so those partitions
   * overshoot in brightness and colour.
   */
  resBloom: 2,
  /**
   * Feature size of the zone mask's noise, px per noise unit. The mask is
   * the soft disc minus `0.5 * noise` (noise 0..1), so the zone has dead spots
   * and weaker patches; larger values make them bigger.
   */
  noiseScale: 5 * MB,
  /** How fast the zone noise changes, noise units per second of decoder time. */
  noiseSpeed: 0.12,
  /**
   * Regulariser added to the Lucas–Kanade structure tensor in `flow.frag`
   * (luma gradient² units, scaled up at coarser pyramid levels). Higher makes
   * flat, low-texture blocks read as still rather than noisy, at the cost of
   * underestimating motion on faint texture.
   */
  flowEps: 2e-4,
  /**
   * Radius, px, of the encoder's coarse motion-search window around its best
   * predicted vector (`search.frag`, in 4 px steps on the quarter-resolution
   * mip). Predictors include last step's vectors, so steady motion is tracked
   * at any speed; this bounds how much a block's motion can jump in one step
   * and still be found. Cost grows with its square.
   */
  searchRange: 24,
  /**
   * Intra decision margin: mean absolute YCbCr error per pixel (0..1 values,
   * summed over Y, Cb and Cr) by which a macroblock's best intra prediction
   * (H.264 Intra16x16 vertical, horizontal or DC from its coded neighbours)
   * must beat inter prediction from the previous source frame along the
   * background's vector. Intra is the only thing that clears mosh, so lower
   * clears faster; it happens where the footage shows something the
   * previous frame didn't (content panning in at an edge, disocclusion, cuts
   * within the clip).
   */
  intraBias: 0.16,
  /**
   * DC quantiser step for the residual, on 0..1 values, from {@link QP} like
   * H.264 (`0.625 * 2^(QP / 6) / 255`). `dctCols.frag` scales it up by
   * frequency and by 1.6 for chroma. Coarser steps drop more of the
   * motion-compensated residual from moshed blocks.
   */
  qstep: (0.625 * 2 ** (QP / 6)) / 255,
};

/** The shape of {@link params}. */
export type Params = typeof params;
