# MySportzStats – Push-Only Live Cricket + PWA

Pure WebSocket + Durable Objects live cricket scoring with full PWA support (installable on mobile).

## Features

- Zero client polling (true push-only)
- Real-time score, chat, presence, floats, chase timer
- Installable PWA (Add to Home Screen)
- Works on Cloudflare Free plan (SQLite Durable Objects)

## Deploy

```bash
npm install
npx wrangler login
npx wrangler deploy
```

After deploy:

- Viewer: `https://YOUR_WORKER.workers.dev/live?match=match1`
- Scorer: `https://YOUR_WORKER.workers.dev/score?match=match1`

## Local Development

```bash
npx wrangler dev
```

## Important Notes

- Folder names **must** be lowercase (`src`, `public`)
- File names **must** be lowercase (`index.js`, not `Index.js`)
- Icons (`icon-192.png` + `icon-512.png`) are required for proper PWA install prompt

## Structure

```
├── package.json
├── wrangler.toml
├── src/
│   ├── index.js
│   └── match.js
└── public/
    ├── live.html
    ├── score.html
    ├── manifest.json
    ├── sw.js
    ├── icon-192.png   ← you must add
    └── icon-512.png   ← you must add
```
