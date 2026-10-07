# MySportzStats – Live Cricket Scorer + Viewer

Push-only live cricket scoring with **Cloudflare Workers + Durable Objects + PWA**.

## Fixes in this package

| Problem | Fix |
|--------|-----|
| Install opened empty Live sample | Main `manifest.json` → `start_url: "/"` (Scorer) |
| Live page 404s | Added `manifest-live.json`, `sw-live.js`, `icon-live-*.png` |
| Viewer stuck at 0/0 | Worker handles `POST /api/live` + `GET /api/live-public` via Durable Object |

## Repo layout (upload this to GitHub root)

```
├── public/
│   ├── index.html          ← full Scorer app
│   ├── live.html           ← Live Viewer
│   ├── score.html          ← minimal demo scorer (optional)
│   ├── manifest.json       ← PWA: opens Scorer (/)
│   ├── manifest-live.json  ← PWA: opens Viewer (/live)
│   ├── sw.js
│   ├── sw-live.js
│   ├── icon-192.png
│   ├── icon-512.png
│   ├── icon-live-192.png
│   └── icon-live-512.png
├── src/
│   ├── index.js            ← Worker entry
│   └── match.js            ← Durable Object (live state + WebSocket)
├── wrangler.toml
├── package.json
└── README.md
```

## Deploy to Cloudflare

### Option A – CLI (recommended)

```bash
# 1. Unzip / clone this package as the repo root
cd mysportzstats

# 2. Install + login
npm install
npx wrangler login

# 3. Deploy
npx wrangler deploy
```

URLs:

- **Scorer:** `https://mysportzstats.<subdomain>.workers.dev/`
- **Live viewer:** `https://mysportzstats.<subdomain>.workers.dev/live`

### Option B – GitHub + Cloudflare

1. Create a GitHub repo.
2. Upload **keeping folders** `public/`, `src/`, plus `wrangler.toml` and `package.json` at root.
3. Cloudflare → Workers & Pages → connect the repo (or deploy via CLI after clone).
4. Durable Objects migration runs from `wrangler.toml` on first deploy.

## After first deploy

1. Open **`/`** → Scorer. Install the app **from here**.
2. Open **`/live`** → Viewer.
3. Scorer Live Server URL = same origin (auto on workers.dev).
4. Publish key default: `PUBLISH_2026`.
5. If you installed the old app before: uninstall icon → clear site data → re-install from `/`.

## Local dev

```bash
npm install
npx wrangler dev
```

Open `http://localhost:8787/` and `http://localhost:8787/live`.

## Notes

- Do **not** flatten files into the repo root — `wrangler.toml` expects `public/` and `src/`.
- Service workers do not cache `/api/*` or `/ws`.
- Main installable app is the **Scorer** (`manifest.json` → `/`).
