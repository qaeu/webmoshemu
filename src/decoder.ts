/**
 * The datamosh decoder loop.
 *
 * @module
 */
import * as THREE from 'three';

import { STEP, params } from './config';
import type { Gl } from './gl';
import type { Passes } from './passes';
import type { Pointer } from './pointer';
import type { Source } from './sources';
import { allocateTargets, disposeTargets, internalSize, type Targets } from './targets';

// ── Decoder ──────────────────────────────────────────────────────────────────
/**
 * A simplified inter-frame decoder fed by a {@link Source}. Each step encodes
 * the source frame's motion and quantised residual, then decodes them against
 * its own previous output, which is what lets the picture mosh.
 */
export class Decoder {
  private t: Targets;
  private time = 0;
  private frameNo = 0;
  // Swap sources like a datamosh cut with the new clip's I-frame removed: the
  // decoder keeps its last decoded frame as the reference, the next step marks
  // every inter pixel moshed, and the new footage's residuals and motion then
  // play out over the old picture until its intra blocks replace it.
  private cutPending = false;
  private phase = new THREE.Vector4();

  /**
   * Allocate targets for the viewport and seed them from `source`.
   *
   * @param viewW - Viewport width in CSS px; only the aspect ratio matters.
   * @param viewH - Viewport height in CSS px.
   */
  constructor(
    private gl: Gl,
    private passes: Passes,
    /** The current source; swap it with {@link Decoder.setSource}. */
    public source: Source,
    viewW: number,
    viewH: number,
  ) {
    const { w, h } = internalSize(viewW, viewH);
    this.t = this.allocate(w, h);
  }

  /** Internal size in decoder pixels. */
  get size(): { w: number; h: number } {
    return { w: this.t.w, h: this.t.h };
  }

  /**
   * Reallocate for a new viewport if the internal size changes. Reallocation
   * starts clean, as on construction.
   *
   * @returns Whether the targets were reallocated.
   */
  resize(viewW: number, viewH: number): boolean {
    const { w, h } = internalSize(viewW, viewH);
    if (w === this.t.w && h === this.t.h) return false;
    disposeTargets(this.t);
    this.t = this.allocate(w, h);
    return true;
  }

  /** Allocate targets, zero the block state and seed `src[1]` and `ref[0]` from the source. */
  private allocate(w: number, h: number): Targets {
    const t = allocateTargets(w, h);
    this.passes.background.uniforms.uSize.value.set(w, h);
    this.passes.video.uniforms.uSize.value.set(w, h);

    // Start clean: zero block state, and a first source frame to diff against.
    const { renderer } = this.gl;
    for (const rt of [...t.state, ...t.sub, ...t.flow]) {
      renderer.setRenderTarget(rt);
      renderer.clear();
    }
    this.source.draw(t.src[1], this.time);
    this.source.draw(t.ref[0], this.time);
    return t;
  }

  /**
   * Cut to `next`, disposing the current source. The new frame becomes `prev`
   * so the first step sees no motion or residual across the cut, and that step
   * marks every inter pixel moshed.
   */
  setSource(next: Source): void {
    this.source.dispose();
    this.source = next;
    this.source.draw(this.t.src[1], this.time);
    this.cutPending = true;
  }

  /**
   * Decode one source frame.
   *
   * @param dt - The frame's duration in seconds.
   * @param pointer - Advanced by this step's duration before it is read.
   */
  step(dt: number, pointer: Pointer): void {
    const { gl, passes } = this;
    const { src, state, sub, ref, coef, tmp, lk, flow, mask } = this.t;
    this.time += dt;
    this.frameNo++;

    // Tuning is per decoded frame, but the pointer's smoothing and speed
    // reference are scaled by frame duration so it feels the same at any rate.
    const k = dt / STEP;
    pointer.advance(k);

    // 1. New source frame.
    this.source.draw(src[0], this.time);
    const [cur, prev] = src;

    // 2. The background's own motion vectors: a Lucas–Kanade estimate, then
    // the encoder's search seeded by it and by last step's vectors.
    const fu = passes.flow.uniforms;
    fu.uCur.value = cur.texture;
    fu.uPrev.value = prev.texture;
    gl.draw(passes.flow, lk);
    const xu = passes.search.uniforms;
    xu.uCur.value = cur.texture;
    xu.uPrev.value = prev.texture;
    xu.uLk.value = lk.texture;
    xu.uLast.value = flow[0].texture;
    gl.draw(passes.search, flow[1]);
    flow.reverse();

    // 3. Pointer zone mask.
    const mu = passes.mask.uniforms;
    mu.uPointer.value.copy(pointer.pos);
    mu.uActive.value = pointer.active;
    mu.uTime.value = this.time;
    gl.draw(passes.mask, mask);

    // Low-discrepancy (R2 / golden-ratio) rounding phases, shared by the
    // encoder's predictions and the decoder's.
    const n = this.frameNo;
    const phase = this.phase.set(
      (n * 0.7548776662) % 1,
      (n * 0.5698402910) % 1,
      (n * 0.6180339887 + 0.5) % 1,
      (n * 0.4142135624 + 0.5) % 1,
    );

    // 4. The encoder's intra/inter decision, and the melt latch.
    const bu = passes.blocks.uniforms;
    bu.uState.value = state[0].texture;
    bu.uSub.value = sub[0].texture;
    bu.uCur.value = cur.texture;
    bu.uPrev.value = prev.texture;
    bu.uFlow.value = flow[0].texture;
    bu.uPhase.value.copy(phase);
    gl.draw(passes.blocks, state[1]);
    state.reverse();

    // 5. Sub-block vectors and partitions.
    const velocity = pointer.velocity.clone().clampLength(0, 20 * k);
    const su = passes.sub.uniforms;
    su.uSub.value = sub[0].texture;
    su.uState.value = state[0].texture;
    su.uMask.value = mask.texture;
    su.uPointer.value.copy(pointer.pos);
    su.uVelocity.value.copy(velocity);
    su.uSpeedRef.value = params.speedRef * k;
    su.uTime.value = this.time;
    gl.draw(passes.sub, sub[1]);
    sub.reverse();

    // 6. The encoder's quantised residual against the background's vector
    // (separable DCT: rows, then columns), and the first half of its inverse.
    const dr = passes.dctRows.uniforms;
    dr.uCur.value = cur.texture;
    dr.uPrev.value = prev.texture;
    dr.uState.value = state[0].texture;
    dr.uFlow.value = flow[0].texture;
    dr.uPhase.value.copy(phase);
    gl.draw(passes.dctRows, tmp);
    const dc = passes.dctCols.uniforms;
    dc.uTmp.value = tmp.texture;
    dc.uState.value = state[0].texture;
    gl.draw(passes.dctCols, coef);
    const ir = passes.idctRows.uniforms;
    ir.uCoef.value = coef.texture;
    ir.uState.value = state[0].texture;
    gl.draw(passes.idctRows, tmp);

    // 7. Reconstruct against the (wrong) previous decoded frame.
    const cu = passes.reconstruct.uniforms;
    cu.uRef.value = ref[0].texture;
    cu.uCur.value = cur.texture;
    cu.uTmp.value = tmp.texture;
    cu.uState.value = state[0].texture;
    cu.uSub.value = sub[0].texture;
    cu.uFlow.value = flow[0].texture;
    cu.uPhase.value.copy(phase);
    cu.uCut.value = this.cutPending ? 1 : 0;
    this.cutPending = false;
    gl.draw(passes.reconstruct, ref[1]);
    ref.reverse();

    src.reverse();
  }

  /**
   * Draw the latest decoded frame to the screen.
   *
   * @param debug - Also draw the mask, vectors and partition edges.
   */
  present(debug: boolean): void {
    const { src, state, sub, ref, flow, mask } = this.t;
    const pu = this.passes.present.uniforms;
    pu.uRef.value = ref[0].texture;
    pu.uCur.value = src[1].texture;
    pu.uState.value = state[0].texture;
    pu.uSub.value = sub[0].texture;
    pu.uFlow.value = flow[0].texture;
    pu.uMask.value = mask.texture;
    pu.uDebug.value = debug;
    this.gl.draw(this.passes.present, null);
  }
}
