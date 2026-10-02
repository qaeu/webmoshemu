/**
 * Pointer tracking for the effect's zone and vortex.
 *
 * @module
 */
import * as THREE from 'three';

import type { STEP } from './config';

// ── Pointer ──────────────────────────────────────────────────────────────────
/** The pointer, tracked in internal decoder pixels with origin bottom-left. */
export class Pointer {
  /** Latest position. */
  pos = new THREE.Vector2();
  /** Smoothed motion in px per step; see {@link Pointer.advance}. */
  velocity = new THREE.Vector2();
  /** Smoothed presence, 0..1: eases to 1 while the pointer is over the canvas. */
  active = 0;
  private last: THREE.Vector2 | null = null;
  private delta = new THREE.Vector2();
  private target = 0;

  /** @param size - Returns the current internal decoder size. */
  constructor(private size: () => { w: number; h: number }) {}

  /** Listen for pointer events on `canvas`. */
  attach(canvas: HTMLCanvasElement): void {
    canvas.addEventListener('pointerdown', (e) => {
      canvas.setPointerCapture(e.pointerId);
      this.last = null;
      this.onPointer(e);
    });
    canvas.addEventListener('pointermove', this.onPointer);
    canvas.addEventListener('pointerup', this.onRelease);
    canvas.addEventListener('pointercancel', this.onRelease);
    canvas.addEventListener('pointerleave', this.onRelease);
  }

  /** Forget the last sample so the next one adds no delta (e.g. after a resize). */
  reset(): void {
    this.last = null;
  }

  /**
   * Fold the motion accumulated since the last step into {@link Pointer.velocity}
   * and ease {@link Pointer.active}.
   *
   * @param k - This step's duration in units of {@link STEP}.
   */
  advance(k: number): void {
    this.velocity.lerp(this.delta, 1 - 0.5 ** k);
    this.delta.set(0, 0);
    this.active += (this.target - this.active) * (1 - 0.92 ** k);
  }

  /** Convert a client-space event position to internal decoder px. */
  private toInternal(e: PointerEvent): THREE.Vector2 {
    const { w, h } = this.size();
    return new THREE.Vector2(
      (e.clientX / window.innerWidth) * w,
      (1 - e.clientY / window.innerHeight) * h,
    );
  }

  private onPointer = (e: PointerEvent): void => {
    this.target = 1;
    const samples = e.getCoalescedEvents?.() ?? [];
    for (const s of samples.length ? samples : [e]) {
      const p = this.toInternal(s);
      if (this.last) this.delta.add(p.clone().sub(this.last));
      this.last = p;
      this.pos.copy(p);
    }
  };

  private onRelease = (e: PointerEvent): void => {
    if (e.type === 'pointerleave' || e.pointerType !== 'mouse') {
      this.target = 0;
      this.last = null;
    }
  };
}
