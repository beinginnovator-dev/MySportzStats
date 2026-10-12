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

/** Aura-1 speakers (Deepgram via Workers AI) */
const AURA_SPEAKERS = new Set([
  "angus", "asteria", "arcas", "orion", "orpheus", "athena",
  "luna", "zeus", "perseus", "helios", "hera", "stella",
]);

async function handleTts(request, env) {
  if (!env.AI) {
    return json({ ok: false, error: "Workers AI not bound" }, 503);
  }

  let text = "";
  let voice = "asteria";
  let lang = "en";

  try {
    const url = new URL(request.url);
    if (request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      text = String(body.text || body.q || body.prompt || "").trim();
      voice = String(body.voice || body.speaker || url.searchParams.get("voice") || "asteria").toLowerCase();
      lang = String(body.lang || url.searchParams.get("lang") || "en").toLowerCase();
    } else {
      text = String(url.searchParams.get("q") || url.searchParams.get("text") || "").trim();
      voice = String(url.searchParams.get("voice") || url.searchParams.get("speaker") || "asteria").toLowerCase();
      lang = String(url.searchParams.get("lang") || "en").toLowerCase();
    }
  } catch (_) {
    return json({ ok: false, error: "bad request" }, 400);
  }

  text = text.replace(/\s+/g, " ").slice(0, 280);
  if (!text) return json({ ok: false, error: "empty text" }, 400);

  // Hindi / non-EN → MeloTTS (lang-based). English → Aura with named speaker.
  const useMelo = lang === "hi" || lang.startsWith("hi") || voice === "melo" || voice === "india";

  try {
    if (!useMelo && AURA_SPEAKERS.has(voice)) {
      const resp = await env.AI.run(
        "@cf/deepgram/aura-1",
        { text, speaker: voice, encoding: "mp3" },
        { returnRawResponse: true }
      );
      if (resp && resp.ok) {
        const buf = await resp.arrayBuffer();
        return new Response(buf, {
          status: 200,
          headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "no-store",
            ...CORS,
          },
        });
      }
    }

    // MeloTTS fallback / Hindi
    const meloLang = useMelo && (lang === "hi" || lang.startsWith("hi")) ? "en" : (lang === "hi" ? "en" : "en");
    // Melo on CF mainly: en, es, fr, zh, jp, kr — for Hindi commentary we still try en melo then client falls back
    const melo = await env.AI.run("@cf/myshell-ai/melotts", {
      prompt: text,
      lang: meloLang === "hi" ? "en" : meloLang,
    });

    // Melo may return { audio: base64 } or raw
    if (melo && typeof melo === "object" && melo.audio) {
      const b64 = melo.audio;
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      return new Response(bin, {
        status: 200,
        headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", ...CORS },
      });
    }
    if (melo instanceof ArrayBuffer) {
      return new Response(melo, {
        status: 200,
        headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", ...CORS },
      });
    }
    // Some runtimes return ReadableStream / Response-like
    if (melo && melo.arrayBuffer) {
      const buf = await melo.arrayBuffer();
      return new Response(buf, {
        status: 200,
        headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", ...CORS },
      });
    }

    return json({ ok: false, error: "tts empty" }, 502);
  } catch (e) {
    return json({ ok: false, error: String(e && e.message ? e.message : e) }, 502);
  }
}


/** Platform-wide config (ads + short codes) lives in a dedicated Durable Object name */
function platformStub(env) {
  return env.MATCH.get(env.MATCH.idFromName("__platform_config"));
}

function adminOk(request, env) {
  const key = (env && env.ADMIN_KEY) || "mysportz-admin-2024";
  const h = request.headers.get("X-Admin-Key") || request.headers.get("Authorization") || "";
  const q = new URL(request.url).searchParams.get("key") || "";
  const bodyKey = ""; // optional
  const token = h.replace(/^Bearer\s+/i, "").trim() || q;
  return token && token === key;
}

function shortCode(n) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  let s = "";
  const arr = new Uint8Array(n || 6);
  crypto.getRandomValues(arr);
  for (let i = 0; i < arr.length; i++) s += chars[arr[i] % chars.length];
  return s;
}

async function handlePlatform(request, env, url) {
  const cors = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
  };
  const stub = platformStub(env);

  // Public: active ad banners for all viewer pages
  if (url.pathname === "/api/ads" && request.method === "GET") {
    const r = await stub.fetch(new Request("https://platform/ads-get", { method: "GET" }));
    return r;
  }

  // Admin: set banners (app creator only)
  if (url.pathname === "/api/admin/ads" && request.method === "POST") {
    if (!adminOk(request, env)) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401, headers: cors });
    }
    const body = await request.json().catch(() => ({}));
    const r = await stub.fetch(
      new Request("https://platform/ads-set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
    );
    return r;
  }

  // Admin: list ads
  if (url.pathname === "/api/admin/ads" && request.method === "GET") {
    if (!adminOk(request, env)) {
      return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401, headers: cors });
    }
    const r = await stub.fetch(new Request("https://platform/ads-get?all=1", { method: "GET" }));
    return r;
  }

  // Create short link for a match
  if (url.pathname === "/api/short" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const matchId = String(body.match || body.matchId || "default").slice(0, 80);
    const title = String(body.title || body.matchDesc || "Live Cricket").slice(0, 120);
    const teamA = String(body.teamA || "").slice(0, 40);
    const teamB = String(body.teamB || "").slice(0, 40);
    const code = shortCode(6);
    await stub.fetch(
      new Request("https://platform/short-set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, matchId, title, teamA, teamB, ts: Date.now() }),
      })
    );
    const origin = url.origin;
    const shortUrl = origin + "/m/" + code;
    const liveUrl = origin + "/live.html?match=" + encodeURIComponent(matchId);
    return new Response(
      JSON.stringify({ ok: true, code, shortUrl, liveUrl, title }),
      { headers: cors }
    );
  }

  // Resolve short code
  if (url.pathname === "/api/short" && request.method === "GET") {
    const code = url.searchParams.get("code") || "";
    const r = await stub.fetch(new Request("https://platform/short-get?code=" + encodeURIComponent(code)));
    return r;
  }

  return null;
}

async function handleShortPage(request, env, url) {
  // /m/CODE — human redirect + OG poster for WhatsApp/Telegram scrapers
  const code = url.pathname.slice(3).split("/")[0]; // after /m/
  if (!code) return new Response("Not found", { status: 404 });
  const stub = platformStub(env);
  const r = await stub.fetch(new Request("https://platform/short-get?code=" + encodeURIComponent(code)));
  const data = await r.json().catch(() => ({}));
  if (!data || !data.ok || !data.matchId) {
    return new Response("Link expired or not found", { status: 404 });
  }
  const matchId = data.matchId;
  const title = data.title || "Live Cricket Match";
  const teamA = data.teamA || "Team A";
  const teamB = data.teamB || "Team B";
  const liveUrl = new URL("/live.html?match=" + encodeURIComponent(matchId), url.origin).toString();
  const posterUrl = new URL("/api/poster?title=" + encodeURIComponent(title) + "&a=" + encodeURIComponent(teamA) + "&b=" + encodeURIComponent(teamB), url.origin).toString();
  const ua = (request.headers.get("User-Agent") || "").toLowerCase();
  const isBot = /bot|crawl|slurp|facebookexternalhit|whatsapp|telegram|twitter|linkedin|discord|preview/i.test(ua);

  if (!isBot) {
    return Response.redirect(liveUrl, 302);
  }

  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<title>${escapeHtml(title)} | Live Score</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta property="og:type" content="website"/>
<meta property="og:title" content="${escapeHtml(title)}"/>
<meta property="og:description" content="${escapeHtml(teamA)} vs ${escapeHtml(teamB)} — watch live ball-by-ball scores"/>
<meta property="og:image" content="${posterUrl}"/>
<meta property="og:url" content="${url.origin}/m/${encodeURIComponent(code)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${escapeHtml(title)}"/>
<meta name="twitter:description" content="${escapeHtml(teamA)} vs ${escapeHtml(teamB)} — Live"/>
<meta name="twitter:image" content="${posterUrl}"/>
<meta http-equiv="refresh" content="0;url=${liveUrl}"/>
</head><body style="font-family:system-ui;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0">
<div style="text-align:center;padding:24px">
  <div style="font-size:48px">🏏</div>
  <h1 style="font-size:1.25rem;margin:12px 0">${escapeHtml(title)}</h1>
  <p style="opacity:.8">${escapeHtml(teamA)} vs ${escapeHtml(teamB)}</p>
  <p><a href="${liveUrl}" style="color:#34d399">Open live score →</a></p>
</div>
</body></html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=60" },
  });
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function handlePoster(url) {
  const title = url.searchParams.get("title") || "Live Cricket";
  const a = url.searchParams.get("a") || "Team A";
  const b = url.searchParams.get("b") || "Team B";
  // SVG poster (works as og:image for many scrapers)
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0f172a"/>
      <stop offset="50%" stop-color="#1e3a5f"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#g)"/>
  <rect x="40" y="40" width="1120" height="550" rx="28" fill="none" stroke="#fbbf24" stroke-width="4" opacity="0.5"/>
  <text x="600" y="160" text-anchor="middle" font-family="system-ui,Segoe UI,sans-serif" font-size="42" font-weight="800" fill="#fbbf24">LIVE CRICKET</text>
  <text x="600" y="280" text-anchor="middle" font-family="system-ui,Segoe UI,sans-serif" font-size="56" font-weight="900" fill="#ffffff">${escapeXml(a)}</text>
  <text x="600" y="350" text-anchor="middle" font-family="system-ui,Segoe UI,sans-serif" font-size="36" font-weight="700" fill="#94a3b8">vs</text>
  <text x="600" y="430" text-anchor="middle" font-family="system-ui,Segoe UI,sans-serif" font-size="56" font-weight="900" fill="#ffffff">${escapeXml(b)}</text>
  <text x="600" y="520" text-anchor="middle" font-family="system-ui,Segoe UI,sans-serif" font-size="28" font-weight="600" fill="#34d399">${escapeXml(title.slice(0, 48))}</text>
</svg>`;
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function escapeXml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    // AI TTS — multi-voice
    if (url.pathname === "/api/tts") {
      return handleTts(request, env);
    }

    // Match poster SVG for OG / WhatsApp
    if (url.pathname === "/api/poster") {
      return handlePoster(url);
    }

    // Short share links /m/CODE
    if (url.pathname.startsWith("/m/")) {
      return handleShortPage(request, env, url);
    }

    // Platform ads + short API
    {
      const plat = await handlePlatform(request, env, url);
      if (plat) return plat;
    }

    // WebSocket → Durable Object
    if (url.pathname === "/ws") {
      const matchId = url.searchParams.get("match") || "default";
      return env.MATCH.get(env.MATCH.idFromName(matchId)).fetch(request);
    }

    // Scorer HTTP push
    if (
      (url.pathname === "/api/live" || url.pathname === "/api/update") &&
      request.method === "POST"
    ) {
      const matchId = url.searchParams.get("match") || "default";
      return env.MATCH.get(env.MATCH.idFromName(matchId)).fetch(request);
    }

    // Viewer poll
    if (
      (url.pathname === "/api/live-public" || url.pathname === "/api/live") &&
      request.method === "GET"
    ) {
      const matchId = url.searchParams.get("match") || "default";
      return env.MATCH.get(env.MATCH.idFromName(matchId)).fetch(request);
    }

    const doPaths = [
      "/fans",
      "/viewers-history",
      "/viewer-activity",
      "/admin/reset-viewers",
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

    if (url.pathname === "/" || url.pathname === "/score" || url.pathname === "/index.html") {
      return env.ASSETS.fetch(new Request(new URL("/index.html", request.url), request));
    }
    if (url.pathname === "/live" || url.pathname === "/live.html") {
      return env.ASSETS.fetch(new Request(new URL("/live.html", request.url), request));
    }

    return env.ASSETS.fetch(request);
  },
};
