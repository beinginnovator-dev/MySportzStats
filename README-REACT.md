# MySportzStats React migration

This branch introduces the React scorer as a parallel application. The existing Worker API, Durable Objects, D1 migrations, PWA assets and production scorer remain untouched.

## Run locally

```bash
npm install
npm run dev:react
```

Vite serves the React app locally. To create the static build:

```bash
npm run build:react
```

The build is written to `public/react/`, so it can be served by the existing Cloudflare Worker assets binding at `/react/` after the build has been run and deployed from this branch.

## Current foundation

- Responsive React application shell and scorer dashboard
- Ball entry for dot, 1, 2, 3, four, six, wide, no-ball and wicket
- Legal-ball / over tracking, score, wickets, extras and current run rate
- Undo last delivery
- Browser localStorage autosave for the active match and completed match history
- JSON export of locally saved match data
- History and tournament snapshot tabs

## Migration safety

- Work is isolated on `react-redesign-2026-11-14`.
- `main` is not changed.
- The original app and Worker endpoints are preserved.
- The React foundation is not yet a feature-complete replacement: squad editing, full innings/toss workflow, detailed scorecards, commentary/API integrations, room/chat, fan activity, tournament tables/caps, and cross-device D1 history sync still need to be migrated and tested before switching the production entry point.
