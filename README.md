# MySportzStats – Updated with Uniform Blue Theme

Your original full-featured Scorer (`index.html`) and Live Viewer (`live.html`) with a clean uniform blue theme applied.

## What changed
- Uniform button height, border-radius, font weight and blue accent colour
- Clean dark-blue theme forced across both pages
- All original functionality kept 100%

## Deploy

1. Upload the **contents** of this folder to the root of your GitHub repo.
2. Cloudflare → Retry build.

## URLs after deploy
- Scorer: `https://YOUR_WORKER.workers.dev/` or `/score`
- Viewer: `https://YOUR_WORKER.workers.dev/live`

## Structure
```
├── package.json
├── wrangler.toml
├── src/
│   ├── index.js
│   └── match.js
└── public/
    ├── index.html      ← full original scorer + blue theme
    ├── live.html       ← full original viewer + blue theme
    ├── score.html
    ├── manifest.json
    ├── sw.js
    ├── icon-192.png
    └── icon-512.png
```
