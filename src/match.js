export class MatchDO {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
    this.httpViewers = new Map(); // id -> live heartbeat
    this.viewerLog = new Map(); // persistent session history (online + offline)
    this.viewerDayKey = ''; // YYYY-MM-DD for daily total
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
        const matchId = String((body && (body.match || body.liveMatchId || body.matchId)) || "current").slice(0, 80);
        const tab = body && body.tab ? String(body.tab).slice(0, 24) : "";
        const now = Date.now();
        this.touchViewer(id, name, matchId, now, tab);
        this.expireHttpViewers(now);
        const viewers = this.collectViewers();
        const hist = this.historyPayload();
        return new Response(
          JSON.stringify({
            ok: true,
            viewers,
            count: viewers.filter((v) => v.online).length,
            watching: viewers.filter((v) => v.online).length,
            history: hist.list,
            todayTotal: hist.todayTotal,
            floats: (this.live.floats || []).slice(-15),
          }),
          { headers: cors }
        );
      } catch (_) {
        return new Response(JSON.stringify({ ok: true, viewers: [], count: 0, history: [], todayTotal: 0 }), {
          headers: cors,
        });
      }
    }

    if (url.pathname === "/viewers-history" && request.method === "GET") {
      const hist = this.historyPayload();
      return new Response(JSON.stringify({ ok: true, ...hist }), { headers: cors });
    }

    if (url.pathname === "/viewer-activity" && request.method === "POST") {
      try {
        const body = await request.json().catch(() => ({}));
        const id = String((body && (body.id || body.uid)) || "").slice(0, 64);
        const name = String((body && body.name) || "Fan").slice(0, 40);
        const matchId = String((body && (body.match || body.liveMatchId)) || "current").slice(0, 80);
        const now = Date.now();
        if (id) {
          this.touchViewer(id, name, matchId, now, body.tab || "");
          const rec = this.viewerLog.get(id);
          if (rec) {
            rec.activities = rec.activities || [];
            const act = {
              type: String(body.type || "event").slice(0, 24),
              text: String(body.text || body.emoji || body.tab || "").slice(0, 200),
              emoji: body.emoji ? String(body.emoji).slice(0, 16) : "",
              tab: body.tab ? String(body.tab).slice(0, 24) : "",
              ts: now,
            };
            rec.activities.push(act);
            if (rec.activities.length > 80) rec.activities = rec.activities.slice(-80);
            if (body.tab) {
              rec.tabs = rec.tabs || {};
              rec.tabs[String(body.tab).slice(0, 24)] = (rec.tabs[String(body.tab).slice(0, 24)] || 0) + 1;
            }
            this.viewerLog.set(id, rec);
          }
        }
        return new Response(JSON.stringify({ ok: true }), { headers: cors });
      } catch (_) {
        return new Response(JSON.stringify({ ok: false }), { status: 400, headers: cors });
      }
    }

    if (url.pathname === "/fans" && request.method === "GET") {
      const hist = this.historyPayload();
      const fans = hist.list.map((v) => ({
        id: v.id || v.name,
        name: v.name || "Fan",
        points: v.coins != null ? v.coins : 10,
        correct: 0,
        online: !!v.online,
        joinedAt: v.joinedAt,
        leftAt: v.leftAt,
        matches: v.matches || [],
      }));
      return new Response(JSON.stringify({ ok: true, fans, list: fans, todayTotal: hist.todayTotal }), {
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

    if (url.pathname === "/admin/reset-viewers" && request.method === "POST") {
      try {
        const body = await request.json().catch(() => ({}));
        // accept any admin key style used elsewhere
        this.viewerLog = new Map();
        this.httpViewers = new Map();
        this.live.viewers = [];
        return new Response(JSON.stringify({ ok: true }), { headers: cors });
      } catch (_) {
        return new Response(JSON.stringify({ ok: false }), { status: 400, headers: cors });
      }
    }

    if (url.pathname.startsWith("/admin/")) {
      return new Response(JSON.stringify({ ok: true }), { headers: cors });
    }

    return new Response("Not found", { status: 404 });
  }


  dayKey(ts) {
    try {
      const d = new Date(ts || Date.now());
      return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
    } catch (_) {
      return "unknown";
    }
  }

  touchViewer(id, name, matchId, now, tab) {
    if (!id) return;
    now = now || Date.now();
    matchId = matchId || "current";
    const day = this.dayKey(now);
    this.viewerDayKey = day;

    let rec = this.viewerLog.get(id);
    if (!rec) {
      rec = {
        id,
        name: name || "Fan",
        firstSeen: now,
        joinedAt: now,
        lastSeen: now,
        leftAt: null,
        online: true,
        coins: 10,
        matches: [matchId],
        sessions: [{ joinedAt: now, leftAt: null, matchId }],
        activities: [],
        tabs: {},
        dayKey: day,
      };
    } else {
      const wasOffline = !rec.online;
      rec.name = name || rec.name || "Fan";
      rec.lastSeen = now;
      rec.online = true;
      rec.leftAt = null;
      if (wasOffline) {
        rec.joinedAt = now;
        rec.sessions = rec.sessions || [];
        rec.sessions.push({ joinedAt: now, leftAt: null, matchId });
        if (rec.sessions.length > 20) rec.sessions = rec.sessions.slice(-20);
      }
      rec.matches = rec.matches || [];
      if (matchId && rec.matches.indexOf(matchId) < 0) {
        rec.matches.push(matchId);
        if (rec.matches.length > 30) rec.matches = rec.matches.slice(-30);
      }
      if (rec.sessions && rec.sessions.length) {
        const last = rec.sessions[rec.sessions.length - 1];
        if (last && !last.leftAt) last.matchId = matchId || last.matchId;
      }
    }
    if (tab) {
      rec.tabs = rec.tabs || {};
      const tk = String(tab).slice(0, 24);
      rec.tabs[tk] = (rec.tabs[tk] || 0) + 1;
    }
    this.viewerLog.set(id, rec);
    this.httpViewers.set(id, {
      id,
      name: rec.name,
      joinedAt: rec.joinedAt,
      lastSeen: now,
      coins: rec.coins != null ? rec.coins : 10,
      online: true,
    });
  }

  expireHttpViewers(now) {
    now = now || Date.now();
    for (const [k, v] of [...this.httpViewers.entries()]) {
      if (now - (v.lastSeen || 0) > 45000) {
        this.httpViewers.delete(k);
        const rec = this.viewerLog.get(k);
        if (rec && rec.online) {
          rec.online = false;
          rec.leftAt = v.lastSeen || now;
          if (rec.sessions && rec.sessions.length) {
            const last = rec.sessions[rec.sessions.length - 1];
            if (last && !last.leftAt) last.leftAt = rec.leftAt;
          }
          this.viewerLog.set(k, rec);
        }
      }
    }
    for (const [k, rec] of [...this.viewerLog.entries()]) {
      if (rec.online && now - (rec.lastSeen || 0) > 45000) {
        rec.online = false;
        rec.leftAt = rec.lastSeen || now;
        if (rec.sessions && rec.sessions.length) {
          const last = rec.sessions[rec.sessions.length - 1];
          if (last && !last.leftAt) last.leftAt = rec.leftAt;
        }
        this.viewerLog.set(k, rec);
      }
    }
  }

  historyPayload() {
    this.expireHttpViewers(Date.now());
    const day = this.dayKey(Date.now());
    const list = [...this.viewerLog.values()]
      .map((v) => ({
        id: v.id,
        name: v.name || "Fan",
        online: !!v.online,
        firstSeen: v.firstSeen,
        joinedAt: v.joinedAt,
        lastSeen: v.lastSeen,
        leftAt: v.leftAt,
        coins: v.coins != null ? v.coins : 10,
        matches: v.matches || [],
        sessions: (v.sessions || []).slice(-8),
        activities: (v.activities || []).slice(-40),
        tabs: v.tabs || {},
        dayKey: v.dayKey,
      }))
      .sort((a, b) => (b.lastSeen || 0) - (a.lastSeen || 0));
    const todayTotal = list.filter((v) => {
      const dk = v.dayKey || this.dayKey(v.firstSeen || v.joinedAt);
      return dk === day;
    }).length;
    return { list, todayTotal, day };
  }

  collectViewers() {
    this.expireHttpViewers(Date.now());
    const now = Date.now();
    // Prefer persistent log (includes offline)
    if (this.viewerLog && this.viewerLog.size) {
      return [...this.viewerLog.values()].map((v) => ({
        id: v.id,
        name: v.name || "Fan",
        joinedAt: v.joinedAt || v.firstSeen || now,
        lastSeen: v.lastSeen,
        leftAt: v.leftAt,
        online: !!v.online,
        coins: v.coins != null ? v.coins : 10,
        matches: v.matches || [],
      }));
    }
    const map = new Map();
    for (const s of this.sessions.values()) {
      if (s.role !== "viewer") continue;
      const id = "ws:" + (s.name || "Fan") + ":" + (s.joinedAt || 0);
      map.set(id, { id, name: s.name || "Fan", joinedAt: s.joinedAt || now, online: true, coins: 10 });
    }
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
