import { MatchDO } from "./match.js";
export { MatchDO };
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      const matchId = url.searchParams.get("match") || "default";
      return env.MATCH.get(env.MATCH.idFromName(matchId)).fetch(request);
    }
    if (url.pathname === "/api/update" && request.method === "POST") {
      const matchId = url.searchParams.get("match") || "default";
      return env.MATCH.get(env.MATCH.idFromName(matchId)).fetch(request);
    }
    if (url.pathname.startsWith("/api/")) {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
      });
    }
    if (url.pathname === "/" || url.pathname === "/score" || url.pathname === "/index.html") {
      return env.ASSETS.fetch(new Request(new URL("/index.html", request.url)));
    }
    if (url.pathname === "/live" || url.pathname === "/live.html") {
      return env.ASSETS.fetch(new Request(new URL("/live.html", request.url)));
    }
    return env.ASSETS.fetch(request);
  },
};
