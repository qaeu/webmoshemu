# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run dev       # Vite dev server (http://localhost:5173)
npm run build     # production build to dist/
npm run preview   # serve the built dist/
```

There are no tests, linter, or formatter configured. Verification is visual: run the dev server and move the pointer over the canvas.

Pushing to `main` deploys to GitHub Pages via `.github/workflows/deploy-pages.yml` (Node 22, `npm ci && npm run build`). `vite.config.js` sets `base` to `/<repo>/` only when running in GitHub Actions, so local builds use `/`.

## Architecture

A fullscreen, UI-free datamosh sandbox: a simplified inter-frame video decoder running in WebGL2 via three.js. All logic lives in `src/main.js`; the actual image processing is in `src/shaders/`. See README.md for the effect's design rationale.

**Pass pipeline.** `main.js` draws a single fullscreen quad with a swapped `ShaderMaterial` per pass (`pass()` / `draw()`). Every fragment shader is prefixed with `common.glsl` at build time (imported via Vite `?raw` and string-concatenated), so helpers like `rgb2ycc`, `hash12`, `isInter`, `basis`, the `MB` define and the `fragColor` output are available in every `.frag` without declaring them. `uBasis` (the 8×8 DCT basis) is injected into every pass's uniforms. Shaders are GLSL3 (`#version` is added by three.js).

**Per-step order** (`step()`), each writing to its own render target:
1. `background.frag` → `src[0]` (clean source frame; `src` ping-pongs so `src[1]` is the previous frame)
2. `flow.frag` → `flow` (one texel per macroblock: Lucas–Kanade motion of the background between `src[1]` and `src[0]`; `rg` = px/step, `b` = speed)
3. `mask.frag` → `mask` (one texel per macroblock, `r` = pointer zone strength: a soft disc minus drifting simplex noise scaled to 0–0.5)
4. `blocks.frag` → `state` (ping-pong, one texel per 16×16 macroblock: `rg` = motion vector in internal px, `b` = heat, `a` = random seed). The pointer's heat and vectors scale with its speed (`params.speedRef`) and the mask, so a still pointer does nothing. Outside the pointer's influence, vectors relax towards `-flow` (`params.mvRelax`). Heat has no time decay and only drains where `flow` speed exceeds `params.healSpeed`
5. `residual.frag` → `coef` (quantised 8×8 DCT of `cur - prev`, one texel per coefficient laid out block-locally)
6. `reconstruct.frag` → `ref` (ping-pong feedback: MC from previous decoded frame + IDCT residual for inter blocks, clean source for intra blocks). Fractional vectors are rounded with the per-step `uPhase` dither (shared by all blocks), so sub-pixel motion advances in whole-pixel jumps

`present.frag` then draws to the screen. Pressing `d` toggles a debug overlay: an fps readout (DOM element, `.fps` in `style.css`) and, in `present.frag`, the `mask` shaded translucent black with a white arrow per masked block showing its motion (`-mv`, since `mv` is a fetch offset). Ping-pong buffers are swapped with `array.reverse()` after each write, so index `[0]` is always "latest" after a swap — keep that invariant when adding passes.

**Key invariants.**
- The decoder runs at a fixed internal resolution (short side `SHORT_SIDE = 384`, long side rounded to a multiple of `MB = 16`), independent of screen size. Pointer coordinates are converted to this space with origin bottom-left (`toInternal`). Render targets are reallocated only when the internal size changes.
- Inter vs. intra per block is decided by `isInter()` in `common.glsl` (heat above a per-block seeded threshold); residual, reconstruct and present must all agree on it.
- All render targets are `RGBA16F` (`HalfFloatType`) for iOS renderability — don't switch to 32-bit float. Most use `NearestFilter` and `texelFetch`; only `src` is linear.
- Simulation uses a fixed timestep (`STEP = 1/60`, max two steps per rAF frame); tuning constants live in `params` / the `Tuning` block at the top of `main.js` and are passed as uniforms.
