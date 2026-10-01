# WebMoshemu

A fullscreen datamosh sandbox. A slow dusk-coloured field drifts across the screen, and wherever the pointer moves, a real (tiny) video decoder starts feeding itself the wrong frame. The faster you move, the harder blocks get torn along your motion and wound into a slow spiral drain; a still pointer does nothing. Once you stop, the stale blocks keep their colours but drift with the background's own motion, and stay until the background itself moves strongly enough to wash it out, one macroblock at a time, just as a moshed clip only clears up where the footage has real motion.

There is no UI. Move a mouse, or touch and drag. Without any input the background simply keeps drifting. Drop a video file onto the page to use it as the background instead: the decoder then steps once per video frame, and whatever is moshed at that moment smears across the cut into the new footage. Press `d` for a debug overlay showing the display and decode rates and, shaded in black, the pointer's mask, with a white arrow on each masked block for its motion vector.

## How the effect works

Each frame runs a simplified inter-frame decoder loop in WebGL2 (`src/shaders/`), at a fixed macroblock-aligned internal resolution (short side 384 px):

1. **`background.frag`** / **`video.frag`**: the clean source frame (domain-warped noise with drifting contour lines at 60 Hz, or a dropped video cover-cropped to the internal frame at its own frame rate).
2. **`flow.frag`**: the background's own motion vectors, one per macroblock, from a coarse-to-fine (pyramidal) Lucas–Kanade estimate between the previous and current source frames, using the source frames' mip chain as the image pyramid so it can follow real footage moving several pixels per frame.
3. **`mask.frag`**: the pointer's zone, one value per macroblock: a soft disc minus a drifting 3D simplex noise field (scaled to 0–0.5), so it has dead zones as well as stronger and weaker patches, all shifting over time.
4. **`blocks.frag`**: one texel per 16×16 macroblock. It holds a motion vector and a "heat" value. Inside the pointer's zone, in proportion to the pointer's speed and the mask, blocks heat up and their vectors are pulled towards a vortex (swirl plus inward drain) and the pointer's own drag. Everywhere else, vectors relax towards the background's motion, like later P-frames of the real footage, so moshed pixels drift with the scene. Heat never fades on a timer: it only drains where the background's flow is strong.
5. **`residual.frag`**: an 8×8 DCT of the source's frame-to-frame change, quantised with an H.264-style dead zone (QP 28).
6. **`reconstruct.frag`**: `out = MC(previous decoded frame, mv) + IDCT(residual)` for hot blocks, and the clean source for the rest. Luma is block-copied at integer-pel; chroma is predicted on the 4:2:0 grid in 2 px steps. Vectors are rounded with a per-step dither shared by all blocks, so slow sub-pixel drift advances in whole-pixel jumps without blurring.
7. **`present.frag`**: moshed blocks are shown with nearest sampling so they stay crisp; clean blocks are shown filtered.

Each block leaves the P-frame state at its own random heat threshold, so the edge of the zone is ragged and healing arrives as intra "pops". All feedback targets are RGBA16F, which is renderable on iOS.

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
