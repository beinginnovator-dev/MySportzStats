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
