import { MatchDO } from "./match.js";
export { MatchDO };

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
    const matchId = String(body.match || body.matchId || "default").slice(0, 80);
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
  const desc = data.desc || (teamA + " vs " + teamB + " — live ball-by-ball scores, commentary & stats");
  const liveUrl = new URL("/live.html?match=" + encodeURIComponent(matchId), url.origin).toString();
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

    // PWA assets
    if (url.pathname === "/manifest.json" || url.pathname === "/sw.js" || url.pathname === "/sw-live.js"
        || url.pathname === "/icon-192.png" || url.pathname === "/icon-512.png"
        || url.pathname === "/icon-live-192.png" || url.pathname === "/icon-live-512.png") {
      try {
        if (env.ASSETS) {
          const ar = await env.ASSETS.fetch(request);
          if (ar && ar.status < 400) return ar;
        }
      } catch (eA) {}

    if (url.pathname === "/manifest.json") {
      const body = "{\"name\": \"MySportzStats Cricket Scorer\", \"short_name\": \"Cric Scorer\", \"description\": \"Live cricket scoring, commentary and stats\", \"start_url\": \"/index.html\", \"scope\": \"/\", \"display\": \"standalone\", \"orientation\": \"portrait\", \"background_color\": \"#0f766e\", \"theme_color\": \"#009270\", \"icons\": [{\"src\": \"/icon-192.png\", \"sizes\": \"192x192\", \"type\": \"image/png\", \"purpose\": \"any\"}, {\"src\": \"/icon-512.png\", \"sizes\": \"512x512\", \"type\": \"image/png\", \"purpose\": \"any\"}, {\"src\": \"/icon-192.png\", \"sizes\": \"192x192\", \"type\": \"image/png\", \"purpose\": \"maskable\"}, {\"src\": \"/icon-512.png\", \"sizes\": \"512x512\", \"type\": \"image/png\", \"purpose\": \"maskable\"}]}";
      return new Response(body, { headers: { "Content-Type": "application/manifest+json", "Cache-Control": "no-cache" } });
    }
    if (url.pathname === "/sw.js") {
      const body = "/* MySportzStats scorer SW */\nconst CACHE = 'mysportz-scorer-v1';\nconst ASSETS = ['/index.html', '/manifest.json', '/icon-192.png', '/icon-512.png'];\n\nself.addEventListener('install', function(e) {\n  e.waitUntil(caches.open(CACHE).then(function(c) { return c.addAll(ASSETS).catch(function(){}); }).then(function(){ return self.skipWaiting(); }));\n});\nself.addEventListener('activate', function(e) {\n  e.waitUntil(caches.keys().then(function(keys) {\n    return Promise.all(keys.filter(function(k){ return k !== CACHE; }).map(function(k){ return caches.delete(k); }));\n  }).then(function(){ return self.clients.claim(); }));\n});\nself.addEventListener('fetch', function(e) {\n  var url = new URL(e.request.url);\n  // Never intercept live viewer or API\n  if (url.pathname.indexOf('live.html') >= 0 || url.pathname.indexOf('/api/') === 0 || url.pathname.indexOf('/m/') === 0) {\n    return;\n  }\n  if (e.request.method !== 'GET') return;\n  e.respondWith(\n    fetch(e.request).then(function(r) {\n      try {\n        var copy = r.clone();\n        caches.open(CACHE).then(function(c){ c.put(e.request, copy); });\n      } catch(err){}\n      return r;\n    }).catch(function(){ return caches.match(e.request); })\n  );\n});\n";
      return new Response(body, { headers: { "Content-Type": "application/javascript", "Cache-Control": "no-cache", "Service-Worker-Allowed": "/" } });
    }
    
    if (url.pathname === "/icon-192.png" || url.pathname === "/icon-live-192.png") {
      const bin = Uint8Array.from(atob("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"), c => c.charCodeAt(0));
      return new Response(bin, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
    }
    if (url.pathname === "/icon-512.png" || url.pathname === "/icon-live-512.png") {
      const bin = Uint8Array.from(atob("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"), c => c.charCodeAt(0));
      return new Response(bin, { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
    }

    if (url.pathname === "/sw-live.js") {
      const body = "/* Live viewer \u2014 do not take over navigation */\nself.addEventListener('install', function(e){ self.skipWaiting(); });\nself.addEventListener('activate', function(e){\n  e.waitUntil(self.registration.unregister().then(function(){ return self.clients.claim(); }));\n});\n";
      return new Response(body, { headers: { "Content-Type": "application/javascript", "Cache-Control": "no-cache" } });
    }


    // AI TTS — multi-voice
    if (url.pathname === "/api/tts") {
      return handleTts(request, env);
    }

    // Match poster SVG for OG / WhatsApp
    if (url.pathname === "/api/poster" || url.pathname === "/api/poster.svg") {
      return handlePoster(url);
    }
    if (url.pathname === "/api/poster.png") {
      // Raster redirect for crawlers that hit this path directly
      const a = url.searchParams.get("a") || "Team A";
      const b = url.searchParams.get("b") || "Team B";
      const label = encodeURIComponent((a + " VS " + b).slice(0, 40));
      return Response.redirect("https://placehold.co/1200x630/0f766e/ecfdf5/png?text=" + label, 302);
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
