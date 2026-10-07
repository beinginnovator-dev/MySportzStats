# Cricket Live – Push-Only Architecture

Pure WebSocket + Durable Objects live cricket scoring.

No client-side polling. Updates are pushed the moment the scorer changes the score.

## Quick Start

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

Open http://localhost:8787/live and http://localhost:8787/score

## Architecture

- One Durable Object per match holds live state + all WebSocket connections.
- Scorer pushes only when something changes.
- Durable Object fans the update out to every connected viewer.
- Viewers open a single WebSocket and never poll.
- On disconnect → automatic reconnect with back-off.

## Scaling Notes

| Plan            | Concurrent users (approx.) | Notes                                      |
|-----------------|----------------------------|--------------------------------------------|
| Free            | a few thousand             | 100 k DO requests/day limit                |
| Workers Paid    | 100 k – 1 M+               | Durable Objects scale horizontally         |

## Files

```
src/index.js      – Worker entry + routing
src/match.js      – Durable Object (state + fan-out)
public/live.html  – Viewer (pure WebSocket)
public/score.html – Simple scorer UI
wrangler.toml     – Cloudflare config
```
