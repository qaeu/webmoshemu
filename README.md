# WebMoshemu

Interactive Three.js demo that emulates cursor-localized datamosh-style video codec artifacts with a ping-pong shader feedback loop.

## Demo

Once GitHub Pages is enabled for this repository, the deployment workflow publishes the app automatically from `main`.

Expected URL:

`https://qaeu.github.io/webmoshemu/`

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

## Controls

- Move the cursor to reveal the datamosh zone.
- The circular area around the cursor applies:
  - blocky pseudo motion vectors
  - temporal persistence from prior frames
  - mild chroma misalignment and quantization

## Deployment

GitHub Actions workflow: `.github/workflows/deploy-pages.yml`

- Builds the Vite app on push to `main`
- Uploads `dist/` as Pages artifact
- Deploys via `actions/deploy-pages`

If this is the first deployment, enable **GitHub Pages** in repository settings and set source to **GitHub Actions**.
