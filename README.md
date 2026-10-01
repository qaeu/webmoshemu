# WebMoshemu

A fullscreen datamosh sandbox. A slow dusk-coloured field drifts across the screen, and wherever the pointer goes, a real (tiny) video decoder starts feeding itself the wrong frame. Blocks get torn along your motion and wound into a slow spiral drain. When the pointer leaves, the damage stays put until the background itself moves strongly enough to wash it out, one macroblock at a time, just as a moshed clip only clears up where the footage has real motion.

There is no UI. Move a mouse, or touch and drag. Without any input the background simply keeps drifting.

## How the effect works

Each frame runs a simplified inter-frame decoder loop in WebGL2 (`src/shaders/`), at a fixed macroblock-aligned internal resolution (short side 384 px):

1. **`background.frag`**: the clean source frame (domain-warped noise with drifting contour lines).
2. **`flow.frag`**: the background's own motion vectors, one per macroblock, from a Lucas–Kanade estimate between the previous and current source frames.
3. **`blocks.frag`**: one texel per 16×16 macroblock. It holds a motion vector and a "heat" value. The pointer heats a disc whose rim is displaced by drifting 3D simplex noise, so the zone's edge is organic and keeps shifting. Inside it, vectors are pulled towards a vortex (swirl plus inward drain) and the pointer's own drag. Elsewhere they coast and decay. Heat never fades on a timer: it only drains where the background's flow is strong.
4. **`residual.frag`**: an 8×8 DCT of the source's frame-to-frame change, quantised with an H.264-style dead zone (QP 28).
5. **`reconstruct.frag`**: `out = MC(previous decoded frame, mv) + IDCT(residual)` for hot blocks, and the clean source for the rest. Luma is block-copied at integer-pel; chroma is predicted on the 4:2:0 grid with `floor(mv / 2)`.
6. **`present.frag`**: moshed blocks are shown with nearest sampling so they stay crisp; clean blocks are shown filtered.

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
