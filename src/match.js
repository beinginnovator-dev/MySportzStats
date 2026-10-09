export class MatchDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
    this.httpViewers = new Map(); // id -> {name, joinedAt, lastSeen, coins}
    this.live = {
      ts: 0,
      runs: 0,
      wickets: 0,
      balls: 0,
      overs: "0.0",
      innings: 1,
      score: { runs: 0, wickets: 0, overs: "0.0", innings: 1 },
      target: null,
      maxOvers: 8,
      lastEvent: null,
      thisOver: { balls: [] },
      chase: null,
      viewers: [],
      chat: [],
      floats: [],
      goldCoins: {},
      matchEnded: false,
      teamA: null,
      teamB: null,
      strikerName: "",
      nonStrikerName: "",
      bowlerName: "",
      strikerRuns: 0,
      strikerBalls: 0,
      bowlerRuns: 0,
      bowlerBalls: 0,
      commentary: [],
      statusText: "",
      matchDesc: "",
      predictions: [],
    };
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();

      const name = url.searchParams.get("name") || "Fan";
      const role = url.searchParams.get("role") || "viewer";

      this.sessions.set(server, { name, role, joinedAt: Date.now() });
      this.broadcastPresence();

      server.send(JSON.stringify({ type: "full", data: this.publicPayload() }));

      server.addEventListener("message", (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          this.handleMessage(server, msg);
        } catch (_) {}
      });

      server.addEventListener("close", () => {
        this.sessions.delete(server);
        this.broadcastPresence();
      });

      return new Response(null, { status: 101, webSocket: client });
    }

    const cors = {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    };

    if (
      (url.pathname === "/api/live" || url.pathname === "/api/update") &&
      request.method === "POST"
    ) {
      try {
        const body = await request.json();
        this.applyUpdate(body && body.data ? body.data : body);
        return new Response(JSON.stringify({ ok: true, ts: this.live.ts }), {
          headers: cors,
        });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: String(e) }), {
          status: 400,
          headers: cors,
        });
      }
    }

    if (
      (url.pathname === "/api/live-public" || url.pathname === "/api/live") &&
      request.method === "GET"
    ) {
      return new Response(
        JSON.stringify({ ok: true, data: this.publicPayload(), updatedAt: this.live.ts }),
        { headers: cors }
      );
    }

    if (url.pathname === "/presence" && request.method === "POST") {
      try {
        const body = await request.json().catch(() => ({}));
        const id = String((body && (body.id || body.uid)) || "").slice(0, 64);
        const name = String((body && body.name) || "Fan").slice(0, 40);
        const now = Date.now();
        if (id) {
          const prev = this.httpViewers.get(id) || {};
          this.httpViewers.set(id, {
            id,
            name: name || prev.name || "Fan",
            joinedAt: prev.joinedAt || now,
            lastSeen: now,
            coins: prev.coins != null ? prev.coins : 10,
            online: true,
          });
        }
        for (const [k, v] of [...this.httpViewers.entries()]) {
          if (now - (v.lastSeen || 0) > 45000) this.httpViewers.delete(k);
        }
        const viewers = this.collectViewers();
        return new Response(
          JSON.stringify({
            ok: true,
            viewers,
            count: viewers.length,
            watching: viewers.length,
            floats: (this.live.floats || []).slice(-15),
          }),
          { headers: cors }
        );
      } catch (_) {
        return new Response(JSON.stringify({ ok: true, viewers: [], count: 0 }), {
          headers: cors,
        });
      }
    }

    if (url.pathname === "/fans" && request.method === "GET") {
      const viewers = this.collectViewers();
      const fans = viewers.map((v) => ({
        id: v.id || v.name,
        name: v.name || "Fan",
        points: v.coins != null ? v.coins : 10,
        correct: 0,
      }));
      return new Response(JSON.stringify({ ok: true, fans, list: fans }), {
        headers: cors,
      });
    }

    if (url.pathname === "/chat") {
      if (request.method === "GET") {
        return new Response(
          JSON.stringify({ ok: true, messages: (this.live.chat || []).slice(-40) }),
          { headers: cors }
        );
      }
      if (request.method === "POST") {
        try {
          const body = await request.json();
          const entry = {
            name: body.name || "Fan",
            text: String(body.text || body.message || "").slice(0, 300),
            ts: Date.now(),
          };
          if (entry.text) {
            this.live.chat = this.live.chat || [];
            this.live.chat.push(entry);
            if (this.live.chat.length > 100) this.live.chat.shift();
            this.broadcast({ type: "chat", data: this.live.chat.slice(-20) });
          }
          return new Response(JSON.stringify({ ok: true }), { headers: cors });
        } catch (_) {
          return new Response(JSON.stringify({ ok: false }), { status: 400, headers: cors });
        }
      }
    }

    if (url.pathname === "/floats") {
      if (request.method === "GET") {
        return new Response(
          JSON.stringify({ ok: true, floats: (this.live.floats || []).slice(-30) }),
          { headers: cors }
        );
      }
      if (request.method === "POST") {
        try {
          const body = await request.json();
          const entry = {
            emoji: body.emoji || body.text || "👏",
            name: body.name || "Fan",
            ts: Date.now(),
          };
          this.live.floats = this.live.floats || [];
          this.live.floats.push(entry);
          if (this.live.floats.length > 50) this.live.floats.shift();
          this.broadcast({ type: "float", data: entry });
          return new Response(JSON.stringify({ ok: true }), { headers: cors });
        } catch (_) {
          return new Response(JSON.stringify({ ok: false }), { status: 400, headers: cors });
        }
      }
    }

    if (url.pathname === "/predictions") {
      if (!this.live.predictions) this.live.predictions = [];
      if (request.method === "GET") {
        return new Response(
          JSON.stringify({ ok: true, predictions: this.live.predictions.slice(-40) }),
          { headers: cors }
        );
      }
      if (request.method === "POST") {
        try {
          const body = await request.json();
          this.live.predictions.push({
            id: body.id || "",
            name: body.name || "Fan",
            pred: body.pred || "",
            over_total: body.over_total || "",
            ts: Date.now(),
          });
          if (this.live.predictions.length > 80) this.live.predictions.shift();
          return new Response(
            JSON.stringify({ ok: true, predictions: this.live.predictions.slice(-40) }),
            { headers: cors }
          );
        } catch (_) {
          return new Response(JSON.stringify({ ok: false }), { status: 400, headers: cors });
        }
      }
    }

    if (url.pathname.startsWith("/admin/")) {
      return new Response(JSON.stringify({ ok: true }), { headers: cors });
    }

    return new Response("Not found", { status: 404 });
  }

  collectViewers() {
    const now = Date.now();
    const map = new Map();
    // WebSocket viewers
    for (const s of this.sessions.values()) {
      if (s.role !== "viewer") continue;
      const id = "ws:" + (s.name || "Fan") + ":" + (s.joinedAt || 0);
      map.set(id, {
        id,
        name: s.name || "Fan",
        joinedAt: s.joinedAt || now,
        online: true,
        coins: 10,
      });
    }
    // HTTP heartbeat viewers
    for (const [k, v] of this.httpViewers) {
      if (now - (v.lastSeen || 0) > 45000) continue;
      map.set(v.id || k, {
        id: v.id || k,
        name: v.name || "Fan",
        joinedAt: v.joinedAt || now,
        online: true,
        coins: v.coins != null ? v.coins : 10,
      });
    }
    return [...map.values()];
  }

  publicPayload() {
    const L = this.live || {};
    // Return full scorer payload so viewer gets BOTH team scores, CRR, target, etc.
    // (Previously stripped firstInningsScore / battingSide / crr → "Yet to bat" + CRR 0.00)
    const out = Object.assign({}, L);
    out.ts = L.ts || Date.now();
    out.runs = L.runs != null ? L.runs : (L.score && L.score.runs) || 0;
    out.wickets = L.wickets != null ? L.wickets : (L.score && L.score.wickets) || 0;
    out.balls = L.balls != null ? L.balls : 0;
    out.overs = L.overs || (L.score && L.score.overs) || "0.0";
    out.innings = L.innings != null ? L.innings : (L.score && L.score.innings) || 1;
    out.matchEnded = !!L.matchEnded;
    out.commentary = Array.isArray(L.commentary) ? L.commentary.slice(-30) : [];
    out.floats = Array.isArray(L.floats) ? L.floats.slice(-10) : [];
    // Aliases
    if (out.targetScore == null && L.target != null) out.targetScore = L.target;
    if (out.target == null && L.targetScore != null) out.target = L.targetScore;
    if (out.maxOvers == null) out.maxOvers = L.maxOvers || 8;
    if (!out.thisOver) out.thisOver = { balls: [] };
    // Client-side CRR if missing
    if (out.crr == null && out.balls > 0) {
      out.crr = Math.round((out.runs / (out.balls / 6)) * 100) / 100;
    }
    return out;
  }

  handleMessage(ws, msg) {
    const session = this.sessions.get(ws);
    if (!session) return;

    switch (msg.type) {
      case "chat":
        this.live.chat = this.live.chat || [];
        this.live.chat.push({
          name: session.name,
          text: String(msg.text || "").slice(0, 300),
          ts: Date.now(),
        });
        if (this.live.chat.length > 100) this.live.chat.shift();
        this.broadcast({ type: "chat", data: this.live.chat.slice(-20) });
        break;

      case "float":
        this.live.floats = this.live.floats || [];
        this.live.floats.push({
          emoji: msg.emoji,
          name: session.name,
          ts: Date.now(),
        });
        if (this.live.floats.length > 50) this.live.floats.shift();
        this.broadcast({ type: "float", data: msg });
        break;

      case "score":
        if (session.role === "scorer") {
          this.applyUpdate(msg.data || msg);
        }
        break;

      case "ping":
        try {
          ws.send(JSON.stringify({ type: "pong" }));
        } catch (_) {}
        break;
    }
  }

  applyUpdate(data) {
    if (!data || typeof data !== "object") return;

    Object.assign(this.live, data);
    if (data.score && typeof data.score === "object") {
      this.live.score = { ...this.live.score, ...data.score };
      if (data.score.runs != null) this.live.runs = data.score.runs;
      if (data.score.wickets != null) this.live.wickets = data.score.wickets;
      if (data.score.overs != null) this.live.overs = data.score.overs;
      if (data.score.innings != null) this.live.innings = data.score.innings;
    }
    if (data.runs != null) this.live.runs = data.runs;
    if (data.wickets != null) this.live.wickets = data.wickets;
    if (data.balls != null) this.live.balls = data.balls;
    if (data.overs != null) this.live.overs = data.overs;
    if (Array.isArray(data.thisOver)) {
      this.live.thisOver = { balls: data.thisOver };
    } else if (data.thisOver && typeof data.thisOver === "object") {
      this.live.thisOver = data.thisOver;
    }
    this.live.ts = Date.now();

    if (
      (this.live.innings === 2 || this.live.score?.innings === 2) &&
      this.live.target &&
      !this.live.matchEnded
    ) {
      const oversLeft = this.oversLeft();
      if (oversLeft <= 2) {
        const ballsLeft = Math.round(oversLeft * 6);
        const need = this.live.target - (this.live.runs || 0);
        this.live.chase = {
          need,
          balls: ballsLeft,
          overs: oversLeft.toFixed(1),
          urgent: oversLeft <= 1,
        };
      } else {
        this.live.chase = null;
      }
    }

    const payload = this.publicPayload();
    this.broadcast({ type: "update", data: payload });
    this.broadcast({ type: "score", data: payload });
  }

  oversLeft() {
    const max = this.live.maxOvers || 8;
    const [o, b] = String(this.live.overs || "0.0").split(".").map(Number);
    return max - (o + (b || 0) / 6);
  }

  broadcast(msg) {
    const payload = JSON.stringify(msg);
    for (const [ws] of this.sessions) {
      try {
        ws.send(payload);
      } catch (_) {
        this.sessions.delete(ws);
      }
    }
  }

  broadcastPresence() {
    const viewers = this.collectViewers();
    this.live.viewers = viewers;
    this.broadcast({ type: "presence", data: viewers });
  }
}
