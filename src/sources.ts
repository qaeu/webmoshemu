/**
 * Sources of the clean frames the decoder encodes.
 *
 * @module
 */
import * as THREE from 'three';

import { STEP } from './config';
import type { Gl } from './gl';
import type { Passes } from './passes';

// ── Sources ──────────────────────────────────────────────────────────────────
/**
 * A source supplies the clean frames the decoder encodes. The decoder steps
 * once per source frame.
 */
export interface Source {
  /**
   * Render the current frame into `rt`.
   *
   * @param time - The decoder's clock in seconds.
   */
  draw(rt: THREE.WebGLRenderTarget, time: number): void;
  /**
   * Called once per display frame.
   *
   * @param now - The `requestAnimationFrame` timestamp in ms.
   * @returns Durations (s) of the frames due this display frame, if any; the
   * decoder steps once for each.
   */
  poll(now: number): number[];
  /** Release the source's resources. It is not used afterwards. */
  dispose(): void;
}

/**
 * The animated procedural background, at a fixed {@link STEP} (60 Hz) with at
 * most two steps per display frame.
 */
export function createProcedural(gl: Gl, passes: Passes): Source {
  let last = performance.now();
  let acc = 0;
  return {
    draw(rt, time) {
      passes.background.uniforms.uTime.value = time;
      gl.draw(passes.background, rt);
    },
    poll(now) {
      acc += Math.min((now - last) / 1000, 0.1);
      last = now;
      const due: number[] = [];
      while (acc >= STEP && due.length < 2) {
        due.push(STEP);
        acc -= STEP;
      }
      if (acc > STEP) acc = 0;
      return due;
    },
    dispose() {},
  };
}

/**
 * A muted, looping video file, stepped at its own frame rate (one step per
 * presented frame, timed by `requestVideoFrameCallback` where available).
 *
 * @returns Resolves once the first frame is decodable; that frame becomes the
 * starting reference rather than a step. Rejects if the file can't be played.
 */
export function videoSource(file: File, gl: Gl, passes: Passes): Promise<Source> {
  const url = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.muted = true;
  video.loop = true;
  video.playsInline = true;
  video.src = url;

  const texture = new THREE.VideoTexture(video);
  // The pipeline works on display-encoded values, like the procedural source.
  texture.colorSpace = THREE.NoColorSpace;

  const hasRvfc: boolean = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
  let callback = 0;
  let pending: number | null = null; // media time of the newest unconsumed frame
  let last: number | null = null;
  let dt = 1 / 30;

  const self: Source = {
    draw(rt) {
      passes.video.uniforms.uVideo.value = texture;
      passes.video.uniforms.uVideoSize.value.set(video.videoWidth, video.videoHeight);
      gl.draw(passes.video, rt);
    },
    poll() {
      if (!hasRvfc && !video.paused && video.currentTime !== last) pending = video.currentTime;
      if (pending === null) return [];
      const d = pending - last!; // set before the source resolves
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
    const onFrame: VideoFrameRequestCallback = (_, meta) => {
      if (last === null) {
        // The first frame becomes the starting reference, not a step.
        last = meta.mediaTime;
        resolve(self);
      } else {
        pending = meta.mediaTime;
      }
      callback = video.requestVideoFrameCallback(onFrame);
    };
    const fail = (err: unknown) => {
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
