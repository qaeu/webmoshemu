/**
 * The debug overlay toggle.
 *
 * @module
 */

// ── Debug overlay ('d'): fps readout plus the pointer mask shaded black ─────
/**
 * Toggled with `d`: an fps / decoded-steps-per-second readout, plus the mask
 * and vector overlay drawn by `present.frag`.
 */
export class Debug {
  /** Whether the overlay is shown. */
  on = false;
  private frames = 0;
  private steps = 0;
  private since = performance.now();
  private el = document.createElement('div');

  /** Add the readout element (hidden) and the `d` key listener. */
  constructor() {
    this.el.className = 'fps';
    this.el.hidden = true;
    document.body.appendChild(this.el);

    window.addEventListener('keydown', (e) => {
      if (e.key !== 'd' || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      this.on = !this.on;
      this.el.hidden = !this.on;
      this.frames = 0;
      this.steps = 0;
      this.since = performance.now();
    });
  }

  /** Count `n` decoder steps towards the readout. */
  countSteps(n: number): void {
    this.steps += n;
  }

  /**
   * Count a display frame and refresh the readout every 500 ms.
   *
   * @param now - The `requestAnimationFrame` timestamp in ms.
   */
  countFrame(now: number): void {
    if (!this.on) return;
    this.frames++;
    if (now - this.since >= 500) {
      const rate = (n: number) => Math.round((n * 1000) / (now - this.since));
      this.el.textContent = `${rate(this.frames)} fps · ${rate(this.steps)} dec`;
      this.frames = 0;
      this.steps = 0;
      this.since = now;
    }
  }
}
