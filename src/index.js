import { MatchDO } from "./match.js";
export { MatchDO };

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Publish-Key",
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // WebSocket → Durable Object
    if (url.pathname === "/ws") {
      const matchId = url.searchParams.get("match") || "default";
      return env.MATCH.get(env.MATCH.idFromName(matchId)).fetch(request);
    }

    // Scorer HTTP push (index.html publishLiveViewerState → POST /api/live)
    if (
      (url.pathname === "/api/live" || url.pathname === "/api/update") &&
      request.method === "POST"
    ) {
      const matchId = url.searchParams.get("match") || "default";
      return env.MATCH.get(env.MATCH.idFromName(matchId)).fetch(request);
    }

    // Viewer poll (live.html → GET /api/live-public)
    if (
      (url.pathname === "/api/live-public" || url.pathname === "/api/live") &&
      request.method === "GET"
    ) {
      const matchId = url.searchParams.get("match") || "default";
      return env.MATCH.get(env.MATCH.idFromName(matchId)).fetch(request);
    }

    // Fan / presence / chat / floats / predictions → DO
    const doPaths = [
      "/presence",
      "/chat",
      "/floats",
      "/predictions",
      "/admin/login",
      "/admin/block",
      "/admin/unblock",
      "/admin/reset-coins",
      "/admin/reset-emojis",
      "/admin/blocks",
    ];
    if (doPaths.some((p) => url.pathname === p || url.pathname.startsWith(p + "/"))) {
      const matchId = url.searchParams.get("match") || "default";
      return env.MATCH.get(env.MATCH.idFromName(matchId)).fetch(request);
    }

    if (url.pathname.startsWith("/api/")) {
      return json({ ok: true });
    }

    // Static routes
    if (url.pathname === "/" || url.pathname === "/score" || url.pathname === "/index.html") {
      return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
    }
    if (url.pathname === "/live" || url.pathname === "/live.html") {
      return env.ASSETS.fetch(new Request(new URL("/live.html", request.url), request));
    }

    return env.ASSETS.fetch(request);
  },
};
