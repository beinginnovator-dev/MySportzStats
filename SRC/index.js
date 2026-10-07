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

    // Static assets
    if (url.pathname === "/" || url.pathname === "/live") {
      return env.ASSETS.fetch(new Request(new URL("/live.html", request.url)));
    }
    if (url.pathname === "/score") {
      return env.ASSETS.fetch(new Request(new URL("/score.html", request.url)));
    }

    return env.ASSETS.fetch(request);
  },
};
