import { MatchDO } from "./match.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Publish-Key, X-Admin-Key, x-admin-key",
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

function adminOk(request, env, bodyToken) {
  // Prefer env.ADMIN_KEY (Cloudflare var/secret); fallback to published default
  const key = String((env && env.ADMIN_KEY) || "mysportz-admin-2024").trim();
  const h = request.headers.get("X-Admin-Key")
    || request.headers.get("x-admin-key")
    || request.headers.get("Authorization")
    || "";
  const q = new URL(request.url).searchParams.get("key") || "";
  let token = String(h || "").replace(/^Bearer\s+/i, "").trim() || String(q || "").trim();
  if (!token && bodyToken) token = String(bodyToken).trim();
  if (!token) return false;
  // Exact match, or match against default if dashboard secret empty/wrong during migrate
  if (token === key) return true;
  if (token === "mysportz-admin-2024" && (!env || !env.ADMIN_KEY || String(env.ADMIN_KEY).trim() === "mysportz-admin-2024")) return true;
  return false;
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
    const body = await request.json().catch(() => ({}));
    if (!adminOk(request, env, body && (body.adminKey || body.key))) {
      return new Response(JSON.stringify({
        ok: false,
        error: "unauthorized",
        hint: "Use ADMIN_KEY from wrangler.toml (default mysportz-admin-2024). If you set a Cloudflare Secret named ADMIN_KEY, that value wins — paste the same key here."
      }), { status: 401, headers: cors });
    }
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
    const matchId = String(body.match || body.matchId || "current").slice(0, 80);
    const title = String(body.title || body.matchDesc || "Live Cricket").slice(0, 120);
    const teamA = String(body.teamA || "").slice(0, 40);
    const teamB = String(body.teamB || "").slice(0, 40);
    const desc = String(body.desc || body.description || "").slice(0, 220);
    const imageUrl = String(body.imageUrl || body.image || "").slice(0, 500);
    const code = shortCode(6);
    await stub.fetch(
      new Request("https://platform/short-set", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, matchId, title, teamA, teamB, desc, imageUrl, ts: Date.now() }),
      })
    );
    const origin = url.origin;
    const shortUrl = origin + "/m/" + code;
    const liveUrl = origin + "/live?match=" + encodeURIComponent(matchId || "current");
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
  const desc = data.desc || (teamA + " vs " + teamB + " — live ball-by-ball scores, commentary & stats");
  const liveUrl = new URL("/live?match=" + encodeURIComponent(matchId || "current"), url.origin).toString();
  let customImg = data.imageUrl ? String(data.imageUrl).trim() : "";
  if (customImg && !/^https:\/\//i.test(customImg)) customImg = "";
  const label = encodeURIComponent((teamA + " VS " + teamB).slice(0, 40));
  const posterUrl = customImg || ("https://placehold.co/1200x630/0f766e/ecfdf5/png?text=" + label);
  // Keep local SVG poster available for browsers (not used as og:image)
  const ua = (request.headers.get("User-Agent") || "").toLowerCase();
  const isBot = /bot|crawl|slurp|facebookexternalhit|whatsapp|telegram|twitter|linkedin|discord|preview|skypeuri/i.test(ua);

  // Bots get OG tags; humans get a landing page that opens in the system browser
  // (avoids installed PWA / in-app WebView capturing the link)
  const browserLiveUrl = liveUrl + (liveUrl.indexOf("?") >= 0 ? "&" : "?") + "src=wa";
  // Android Chrome intent — forces Chrome when possible
  const intentUrl = "intent://" + browserLiveUrl.replace(/^https?:\/\//i, "") +
    "#Intent;scheme=https;action=android.intent.action.VIEW;category=android.intent.category.BROWSABLE;package=com.android.chrome;S.browser_fallback_url=" + encodeURIComponent(browserLiveUrl) + ";end";
  const chromeUrl = "googlechrome://navigate?url=" + encodeURIComponent(browserLiveUrl);

  const html = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8"/>
<title>${escapeHtml(title)}</title>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="description" content="${escapeHtml(desc)}"/>
<meta name="mobile-web-app-capable" content="no"/>
<meta name="apple-mobile-web-app-capable" content="no"/>
<meta property="og:type" content="website"/>
<meta property="og:site_name" content="MySportzStats Live"/>
<meta property="og:title" content="${escapeHtml(title)}"/>
<meta property="og:description" content="${escapeHtml(desc)}"/>
<meta property="og:image" content="${posterUrl}"/>
<meta property="og:image:secure_url" content="${posterUrl}"/>
<meta property="og:image:type" content="image/png"/>
<meta property="og:image:width" content="1200"/>
<meta property="og:image:height" content="630"/>
<meta property="og:url" content="${url.origin}/m/${encodeURIComponent(code)}"/>
<meta name="twitter:card" content="summary_large_image"/>
<meta name="twitter:title" content="${escapeHtml(title)}"/>
<meta name="twitter:description" content="${escapeHtml(desc)}"/>
<meta name="twitter:image" content="${posterUrl}"/>
<link rel="image_src" href="${posterUrl}"/>
</head><body style="font-family:system-ui,sans-serif;background:#0f172a;color:#f8fafc;margin:0">
<div style="max-width:520px;margin:0 auto">
  <img src="${posterUrl}" alt="${escapeHtml(title)}" width="1200" height="630" style="display:block;width:100%;height:auto;max-height:320px;object-fit:cover;background:#115e59"/>
  <div style="padding:20px 18px 28px">
    <div style="font-size:12px;font-weight:800;letter-spacing:.12em;color:#5eead4;text-transform:uppercase;margin-bottom:8px">MySportzStats Live</div>
    <h1 style="font-size:1.35rem;margin:0 0 10px;line-height:1.25">${escapeHtml(title)}</h1>
    <p style="opacity:.9;line-height:1.5;margin:0 0 18px;font-size:15px">${escapeHtml(desc)}</p>
    <a href="${browserLiveUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background:#10b981;color:#042f2e;font-weight:800;text-decoration:none;padding:12px 18px;border-radius:10px">Open live score in browser →</a>
    <p style="margin:14px 0 0;font-size:12px;opacity:.75">If it opens inside an app, tap menu → Open in Chrome / browser.</p>
    <p style="margin:10px 0 0"><a href="${intentUrl}" style="color:#5eead4;font-size:13px;font-weight:700">Android: open in Chrome</a></p>
    <script>
    (function(){
      var u = "${browserLiveUrl}";
      try {
        var ua = navigator.userAgent || "";
        // Auto-open for normal browsers; WhatsApp users tap the button
        if (!/WhatsApp|FBAN|FBAV|Instagram/i.test(ua)) {
          window.location.replace(u);
        }
      } catch (e) {}
    })();
    </script>
  </div>
</div>
</body></html>`;
  return new Response(html, {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=120" },
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
  const desc = url.searchParams.get("desc") || "Live ball-by-ball scores";
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0d9488"/>
      <stop offset="45%" stop-color="#0f766e"/>
      <stop offset="100%" stop-color="#115e59"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#bg)"/>
  <circle cx="980" cy="120" r="160" fill="#fbbf24" opacity="0.15"/>
  <circle cx="160" cy="520" r="120" fill="#ffffff" opacity="0.08"/>
  <text x="600" y="120" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="28" font-weight="700" fill="#ecfdf5" letter-spacing="4">LIVE MATCH</text>
  <text x="600" y="250" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="64" font-weight="900" fill="#ffffff">${escapeXml(a)}</text>
  <text x="600" y="330" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="36" font-weight="700" fill="#fde68a">VS</text>
  <text x="600" y="420" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="64" font-weight="900" fill="#ffffff">${escapeXml(b)}</text>
  <text x="600" y="520" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="26" font-weight="600" fill="#ccfbf1">${escapeXml(String(title).slice(0, 50))}</text>
  <text x="600" y="575" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="22" fill="#99f6e4">${escapeXml(String(desc).slice(0, 60))}</text>
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

    // HTML shells — assets.local only (Wrangler 3: run_worker_first = true)
    // Never env.ASSETS.fetch(request) — that causes redirect loops.
    {
      const p = url.pathname;
      const isScorer = (p === "/" || p === "/score" || p === "/index.html");
      const isViewer = (
        p === "/live" ||
        p === "/live.html" ||
        p === "/live-react" ||
        p === "/live-react.html" ||
        p === "/viewer" ||
        p === "/viewers" ||
        p === "/viewer.html"
      );
      if ((isScorer || isViewer) && env.ASSETS) {
        try {
          const tryPaths = isScorer
            ? ["/index.html"]
            : ["/live-react.html", "/viewer.html", "/live.html"];
          for (const assetPath of tryPaths) {
            const res = await env.ASSETS.fetch("https://assets.local" + assetPath);
            if (res && res.status < 400) {
              const buf = await res.arrayBuffer();
              return new Response(buf, {
                status: 200,
                headers: {
                  "Content-Type": "text/html; charset=utf-8",
                  "Cache-Control": "no-store",
                  "X-Served-Asset": assetPath,
                },
              });
            }
          }
        } catch (e) {
          return new Response("Asset error: " + String(e && e.message || e), {
            status: 500,
            headers: { "Content-Type": "text/plain; charset=utf-8" },
          });
        }
        return new Response(
          isScorer
            ? "Scorer missing: upload public/index.html"
            : "Viewer missing: upload public/live-react.html",
          { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } }
        );
      }
    }

    // PWA assets
    if (
      url.pathname === "/manifest.json" ||
      url.pathname === "/sw.js" ||
      url.pathname === "/sw-live.js" ||
      url.pathname === "/icon-192.png" ||
      url.pathname === "/icon-512.png" ||
      url.pathname === "/icon-live-192.png" ||
      url.pathname === "/icon-live-512.png"
    ) {
      try {
        if (env.ASSETS) {
          const ar = await env.ASSETS.fetch("https://assets.local" + url.pathname);
          if (ar && ar.status < 400) return ar;
        }
      } catch (_) {}
    }

    // Short share pages /m/CODE
    if (url.pathname.startsWith("/m/")) {
      return handleShortPage(request, env, url);
    }

    // Poster
    if (url.pathname === "/poster.png" || url.pathname === "/og.png") {
      return handlePoster(url);
    }

    // TTS
    if (url.pathname === "/api/tts") {
      return handleTts(request, env);
    }

    // Platform admin/short APIs
    if (
      url.pathname.startsWith("/api/platform") ||
      url.pathname.startsWith("/api/short") ||
      url.pathname.startsWith("/api/ads")
    ) {
      return handlePlatform(request, env, url);
    }

    // SQL-backed full match history. The payload stores every stats tab and innings.
    if (url.pathname === "/api/history" && request.method === "GET") {
      if (!env.DB) return json({ ok: false, error: "D1 database binding DB is not configured" }, 503);
      try {
        const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 50)));
        const { results = [] } = await env.DB.prepare(
          "SELECT match_id AS matchId, team_a AS teamA, team_b AS teamB, match_name AS matchName, status, result, started_at AS startedAt, updated_at AS updatedAt, completed_at AS completedAt FROM match_history ORDER BY updated_at DESC LIMIT ?"
        ).bind(limit).all();
        return json({ ok: true, matches: results });
      } catch (e) {
        return json({ ok: false, error: String(e && e.message || e) }, 500);
      }
    }
    if (url.pathname.startsWith("/api/history/") && request.method === "GET") {
      if (!env.DB) return json({ ok: false, error: "D1 database binding DB is not configured" }, 503);
      const matchId = decodeURIComponent(url.pathname.slice("/api/history/".length)).slice(0, 120);
      try {
        const row = await env.DB.prepare(
          "SELECT payload_json FROM match_history WHERE match_id = ?"
        ).bind(matchId).first();
        if (!row) return json({ ok: false, error: "Match history not found" }, 404);
        return json({ ok: true, match: JSON.parse(row.payload_json) });
      } catch (e) {
        return json({ ok: false, error: String(e && e.message || e) }, 500);
      }
    }

    // WebSocket + match DO routes
    if (url.pathname === "/ws" || url.pathname.startsWith("/ws/")) {
      const matchId = url.searchParams.get("match") || "current";
      return env.MATCH.get(env.MATCH.idFromName(matchId)).fetch(request);
    }

    // Match API → Durable Object
    const doPaths = [
      "/api/live",
      "/api/live-public",
      "/api/score",
      "/api/state",
      "/api/viewers",
      "/api/cheer",
      "/api/publish",
    ];
    for (const p of doPaths) {
      if (url.pathname === p || url.pathname.startsWith(p + "/")) {
        const matchId = url.searchParams.get("match") || "current";
        return env.MATCH.get(env.MATCH.idFromName(matchId)).fetch(request);
      }
    }

    // Generic /api/* that should hit DO
    if (url.pathname.startsWith("/api/")) {
      const matchId = url.searchParams.get("match") || "current";
      try {
        return env.MATCH.get(env.MATCH.idFromName(matchId)).fetch(request);
      } catch (_) {
        return json({ ok: true });
      }
    }

    // Other static files
    if (env.ASSETS) {
      try {
        const res = await env.ASSETS.fetch("https://assets.local" + url.pathname);
        if (res && res.status < 400) return res;
      } catch (_) {}
    }

    return new Response("Not found: " + url.pathname, {
      status: 404,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  },
};

export { MatchDO };
