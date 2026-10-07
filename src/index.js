import { MatchDO } from "./match.js";

export { MatchDO };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // WebSocket upgrade → Durable Object
    if (url.pathname === "/ws") {
      const matchId = url.searchParams.get("match") || "default";
      const id = env.MATCH.idFromName(matchId);
      const stub = env.MATCH.get(id);
      return stub.fetch(request);
    }

    // Scorer pushes updates here (POST /api/update)
    if (url.pathname === "/api/update" && request.method === "POST") {
      const matchId = url.searchParams.get("match") || "default";
      const id = env.MATCH.idFromName(matchId);
      const stub = env.MATCH.get(id);
      return stub.fetch(request);
    }

    // Static assets routing
    if (url.pathname === "/" || url.pathname === "/score" || url.pathname === "/index.html") {
      return env.ASSETS.fetch(new Request(new URL("/index.html", request.url)));
    }
    if (url.pathname === "/live" || url.pathname === "/live.html") {
      return env.ASSETS.fetch(new Request(new URL("/live.html", request.url)));
    }

    return env.ASSETS.fetch(request);
  },
};
