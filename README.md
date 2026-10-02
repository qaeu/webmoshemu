# WebMoshemu

A fullscreen datamosh sandbox. A slow dusk-coloured field drifts across the screen, and wherever the pointer moves, a real (tiny) video decoder starts feeding itself the wrong frame. The faster you move, the harder blocks get torn along your motion and wound into a slow spiral drain; a still pointer does nothing. Once you stop, the stale blocks keep their colours but drift with the background's own motion, and stay until the background itself moves strongly enough to wash it out, one macroblock at a time, just as a moshed clip only clears up where the footage has real motion.

There is no UI. Move a mouse, or touch and drag. Without any input the background simply keeps drifting. Drop a video file onto the page to use it as the background instead: the decoder then steps once per video frame. The swap plays like a classic datamosh cut with the new clip's I-frame removed: the whole previous picture stays on screen, the new footage's motion drags it around and its changes paint over it, and it only clears where the new video moves strongly. Press `d` for a debug overlay showing the display and decode rates and, shaded in black, the pointer's mask, with a white arrow on each masked partition for its motion vector and lines marking where moshed macroblocks split.

## How the effect works

Each frame runs a simplified inter-frame decoder loop in WebGL2 (`src/shaders/`), at a fixed macroblock-aligned internal resolution (short side 384 px):

1. **`background.frag`** / **`video.frag`**: the clean source frame (domain-warped noise with drifting contour lines at 60 Hz, or a dropped video cover-cropped to the internal frame at its own frame rate).
2. **`flow.frag`**: the background's own motion vectors, one per macroblock, from a coarse-to-fine (pyramidal) Lucas–Kanade estimate between the previous and current source frames, using the source frames' mip chain as the image pyramid so it can follow real footage moving several pixels per frame.
3. **`mask.frag`**: the pointer's zone, one value per macroblock: a soft disc minus a drifting 3D simplex noise field (scaled to 0–0.5), so it has dead zones as well as stronger and weaker patches, all shifting over time.
4. **`blocks.frag`**: one texel per 16×16 macroblock holding its "heat". Inside the pointer's zone, in proportion to the pointer's speed and the mask, blocks heat up. Heat never fades on a timer: it only drains where the background's flow is strong. It also latches a seeded share of blocks with strong vectors into "melt" (see step 7).
5. **`sub.frag`**: one texel per 8×8 sub-block holding the pointer's vector offset. A pixel's actual motion vector is that offset on top of the background's measured motion, so moshed pixels always drift with the scene, like later P-frames of the real footage. Inside the zone, offsets are pulled towards a vortex (swirl plus inward drain) and the pointer's own drag. Each sub-block has its own target, with a seeded twist like an encoder's motion search landing in different local minima. Each macroblock then picks one of the four H.264 shapes (16×16, 16×8, 8×16, 8×8) by rate-distortion: the error of sharing a vector across each part, plus a per-block λ for every extra vector. Everywhere else the offsets decay away, except on a seeded share of "bloom" blocks that hold their vector for much longer.
6. **`dctRows.frag`** → **`dctCols.frag`**: a separable 8×8 DCT of the source's frame-to-frame change, quantised with an H.264-style dead zone (QP 28). **`idctRows.frag`** does the first half of the inverse.
7. **`reconstruct.frag`**: `out = MC(previous decoded frame, mv) + IDCT(residual)` for hot partitions, and the clean source for the rest. Luma is block-copied at integer-pel; chroma is predicted on the 4:2:0 grid in 2 px steps. Vectors are rounded with a per-step dither shared by all blocks, so slow sub-pixel drift advances in whole-pixel jumps without blurring. Melted blocks predict at sub-pixel positions with a bicubic filter instead, so their content smears as it travels; the filter keeps the colours' saturation, since repeatedly averaging neighbouring hues would otherwise turn them brown. If they are unsplit, they also interpolate their vector between neighbouring sub-blocks, so they curl instead of sliding rigidly. Cold blocks decode as an honest encoder's P-blocks would, with the background's own vector: where that fetches moshed pixels, the mosh travels on with the scene out of the hot blocks, until the background moves strongly enough to wash it out; elsewhere they show the clean source. 8×8 partitions close to healing drip the decoded edge next to them into themselves. Melted pixels also drift in colour: chroma lags the pointer's motion slightly and each partition picks up a slow seeded Cb/Cr bias. A tenth of all moshed partitions over-apply their residual.
8. **`present.frag`**: moshed pixels are shown with nearest sampling so they stay crisp; clean pixels are shown filtered.

Each partition leaves the P-frame state at its own random heat threshold, so the edge of the zone is ragged at 8 px and healing arrives as intra "pops". All feedback targets are RGBA16F, which is renderable on iOS.

## Local development

```bash
npm install
npm run dev
```

Then open the printed local URL (typically `http://localhost:5173`).

## Production build

```bash
npm run build
npm run preview
```

## Deployment

GitHub Actions workflow: `.github/workflows/deploy-pages.yml`. Once Pages is enabled, the app is published from `main` to `https://qaeu.github.io/webmoshemu/`.
