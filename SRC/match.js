export class MatchDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map(); // ws → { name, role, joinedAt }
    this.live = {
      score: { runs: 0, wickets: 0, overs: "0.0", innings: 1 },
      target: null,
      maxOvers: 8,
      lastEvent: null,
      thisOver: [],
      chase: null,
      viewers: [],
      chat: [],
      floats: [],
      goldCoins: {},
      matchEnded: false,
    };
  }

  async fetch(request) {
    const url = new URL(request.url);

    // WebSocket connection from viewer or scorer
    if (request.headers.get("Upgrade") === "websocket") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();

      const name = url.searchParams.get("name") || "Fan";
      const role = url.searchParams.get("role") || "viewer"; // viewer | scorer

      this.sessions.set(server, { name, role, joinedAt: Date.now() });
      this.broadcastPresence();

      // Send current full state on connect
      server.send(JSON.stringify({ type: "full", data: this.live }));

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

    // HTTP push from scorer (or any external system)
    if (url.pathname === "/api/update" && request.method === "POST") {
      const body = await request.json();
      this.applyUpdate(body);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response("Not found", { status: 404 });
  }

  handleMessage(ws, msg) {
    const session = this.sessions.get(ws);
    if (!session) return;

    switch (msg.type) {
      case "chat":
        this.live.chat.push({
          name: session.name,
          text: msg.text,
          ts: Date.now(),
        });
        if (this.live.chat.length > 100) this.live.chat.shift();
        this.broadcast({ type: "chat", data: this.live.chat.slice(-20) });
        break;

      case "float":
        this.live.floats.push({
          emoji: msg.emoji,
          name: session.name,
          ts: Date.now(),
        });
        if (this.live.floats.length > 50) this.live.floats.shift();
        this.broadcast({ type: "float", data: msg });
        break;

      case "score": // only scorer may push score
        if (session.role === "scorer") {
          this.applyUpdate(msg.data);
        }
        break;
    }
  }

  applyUpdate(data) {
    // Merge only changed fields
    Object.assign(this.live, data);

    // Recompute chase message if needed
    if (
      this.live.score.innings === 2 &&
      this.live.target &&
      !this.live.matchEnded
    ) {
      const oversLeft = this.oversLeft();
      if (oversLeft <= 2) {
        const ballsLeft = Math.round(oversLeft * 6);
        const need = this.live.target - this.live.score.runs;
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

    this.broadcast({ type: "update", data: this.live });
  }

  oversLeft() {
    const max = this.live.maxOvers || 8;
    const [o, b] = (this.live.score.overs || "0.0").split(".").map(Number);
    return max - (o + b / 6);
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
