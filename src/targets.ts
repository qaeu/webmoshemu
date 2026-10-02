/**
 * The decoder's internal resolution and render targets.
 *
 * @module
 */
import * as THREE from 'three';

import { MB, SB, SHORT_SIDE } from './config';
import { target, type PingPong } from './gl';

type RT = THREE.WebGLRenderTarget;

/**
 * Every render target the decoder uses. Ping-pong buffers are swapped with
 * `array.reverse()` after each write, so index [0] is always "latest" after a
 * swap.
 */
export interface Targets {
  /** Internal width in px, a multiple of {@link MB}. */
  w: number;
  /** Internal height in px, a multiple of {@link MB}. */
  h: number;
  /** Clean source frames, mipmapped; `[1]` is the previous frame. */
  src: PingPong<RT>;
  /** Per-macroblock melt latch, heat and seed. */
  state: PingPong<RT>;
  /** Per-sub-block vector offset and partition code (linear filtered). */
  sub: PingPong<RT>;
  /** Decoded frames; `a` is each pixel's mosh margin. */
  ref: PingPong<RT>;
  /** Quantised DCT coefficients, laid out block-locally. */
  coef: RT;
  /** Separable DCT intermediate, shared by the forward and inverse transforms. */
  tmp: RT;
  /** Per-macroblock background motion. */
  flow: RT;
  /** Per-macroblock pointer zone strength. */
  mask: RT;
}

/**
 * The internal decoder size for a viewport: {@link SHORT_SIDE} on the short
 * side, the long side matching the aspect and rounded to a multiple of
 * {@link MB}.
 */
export function internalSize(viewW: number, viewH: number): { w: number; h: number } {
  const aspect = viewW / viewH;
  const align = (v: number) => Math.max(MB, Math.round(v / MB) * MB);
  const w = aspect >= 1 ? align(SHORT_SIDE * aspect) : SHORT_SIDE;
  const h = aspect >= 1 ? SHORT_SIDE : align(SHORT_SIDE / aspect);
  return { w, h };
}

/** Allocate every target at internal size `w` × `h`. Contents are undefined. */
export function allocateTargets(w: number, h: number): Targets {
  return {
    w,
    h,
    // Source frames carry a mip chain: the image pyramid for flow.frag.
    src: [target(w, h, THREE.LinearFilter, true), target(w, h, THREE.LinearFilter, true)],
    state: [target(w / MB, h / MB), target(w / MB, h / MB)],
    // Linear for the bilinear vector warp in reconstruct's melt path only; every
    // other read is texelFetch, which ignores filtering.
    sub: [target(w / SB, h / SB, THREE.LinearFilter), target(w / SB, h / SB, THREE.LinearFilter)],
    ref: [target(w, h), target(w, h)],
    coef: target(w, h),
    tmp: target(w, h),
    flow: target(w / MB, h / MB),
    mask: target(w / MB, h / MB),
  };
}

/** Free every target in `t`. */
export function disposeTargets(t: Targets): void {
  const { src, state, sub, ref, coef, tmp, flow, mask } = t;
  [...src, ...state, ...sub, ...ref, coef, tmp, flow, mask].forEach((rt) => rt.dispose());
}
