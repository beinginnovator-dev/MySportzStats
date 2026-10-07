export class MatchDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
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
        const viewers = [...this.sessions.values()]
          .filter((s) => s.role === "viewer")
          .map((s) => ({ name: s.name, joinedAt: s.joinedAt, online: true }));
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

  publicPayload() {
    const L = this.live;
    return {
      ts: L.ts || Date.now(),
      runs: L.runs ?? L.score?.runs ?? 0,
      wickets: L.wickets ?? L.score?.wickets ?? 0,
      balls: L.balls ?? 0,
      overs: L.overs || L.score?.overs || "0.0",
      innings: L.innings ?? L.score?.innings ?? 1,
      score: L.score || {
        runs: L.runs || 0,
        wickets: L.wickets || 0,
        overs: L.overs || "0.0",
        innings: L.innings || 1,
      },
      target: L.target,
      maxOvers: L.maxOvers || 8,
      lastEvent: L.lastEvent,
      thisOver: L.thisOver || { balls: [] },
      chase: L.chase,
      matchEnded: !!L.matchEnded,
      teamA: L.teamA,
      teamB: L.teamB,
      strikerName: L.strikerName || "",
      nonStrikerName: L.nonStrikerName || "",
      bowlerName: L.bowlerName || "",
      strikerRuns: L.strikerRuns | 0,
      strikerBalls: L.strikerBalls | 0,
      bowlerRuns: L.bowlerRuns | 0,
      bowlerBalls: L.bowlerBalls | 0,
      commentary: L.commentary || [],
      statusText: L.statusText || "",
      matchDesc: L.matchDesc || "",
      floats: (L.floats || []).slice(-10),
    };
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
    const viewers = [...this.sessions.values()]
      .filter((s) => s.role === "viewer")
      .map((s) => ({
        name: s.name,
        joinedAt: s.joinedAt,
        online: true,
      }));
    this.live.viewers = viewers;
    this.broadcast({ type: "presence", data: viewers });
  }
}
