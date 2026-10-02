/**
 * Entry point: wires the renderer, passes, decoder, pointer, debug overlay
 * and video drops together, and runs the frame loop.
 *
 * @module
 */
import './style.css';

import { Debug } from './debug';
import { Decoder } from './decoder';
import { attachDrop } from './drop';
import { createGl } from './gl';
import { createPasses } from './passes';
import { Pointer } from './pointer';
import { createProcedural, videoSource } from './sources';

const gl = createGl(document.querySelector<HTMLElement>('#app')!);
const passes = createPasses();
const debug = new Debug();

gl.renderer.setSize(window.innerWidth, window.innerHeight);
const decoder = new Decoder(gl, passes, createProcedural(gl, passes), window.innerWidth, window.innerHeight);

const pointer = new Pointer(() => decoder.size);
pointer.attach(gl.canvas);

window.addEventListener('resize', () => {
  gl.renderer.setSize(window.innerWidth, window.innerHeight);
  if (decoder.resize(window.innerWidth, window.innerHeight)) pointer.reset();
});

// Space pauses and resumes; '.' pauses and advances one source frame.
let paused = false;
window.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === ' ') {
    e.preventDefault();
    if (e.repeat) return;
    paused = !paused;
    decoder.source.setPaused(paused);
  } else if (e.key === '.') {
    if (!paused) {
      paused = true;
      decoder.source.setPaused(true);
    }
    decoder.source.advance();
  }
});

let dropId = 0;
attachDrop(async (file) => {
  const id = ++dropId;
  try {
    const next = await videoSource(file, gl, passes);
    // A later drop superseded this one while it was loading.
    if (id !== dropId) next.dispose();
    else {
      next.setPaused(paused);
      decoder.setSource(next);
    }
  } catch (err) {
    console.warn(`Can't play ${file.name}:`, err);
  }
});

/** Step the decoder once per due source frame, then present if anything stepped. */
function frame(now: number) {
  requestAnimationFrame(frame);
  debug.countFrame(now);
  const due = decoder.source.poll(now);
  debug.countSteps(due.length);
  for (const dt of due) decoder.step(dt, pointer);
  // While paused, keep presenting so the debug toggle and resizes show.
  if (due.length || paused) decoder.present(debug.on);
}

requestAnimationFrame(frame);
