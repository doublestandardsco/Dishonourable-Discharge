import { kv } from "@vercel/kv";

function ok(res, data, status = 200) { res.status(status).json({ ok: true, ...data }); }
function err(res, msg, status = 400) { res.status(status).json({ ok: false, error: msg }); }
const key = (id) => `game:${id}`;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();

  try {
    if (req.method === "GET") {
      const { op = "ping", sessionId } = req.query;
      if (op === "ping") return ok(res, { ts: Date.now() });
      if (op === "get") {
        if (!sessionId) return err(res, "sessionId required", 400);
        const state = await kv.get(key(sessionId));
        if (!state) return err(res, "Game not found", 404);
        return ok(res, { state });
      }
      return err(res, "Unknown op", 404);
    }

    if (req.method === "POST") {
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      if (body.op === "create") {
        const { sessionId, maxPlayers = 6, finalAt = null, endsAt = null } = body;
        if (!sessionId) return err(res, "sessionId required", 400);
        const exists = await kv.get(key(sessionId));
        if (exists) return err(res, "Game already exists", 409);
        const state = {
          sessionId,
          maxPlayers: Number(maxPlayers) || 6,
          finalNightAt: finalAt || null,
          gameEndsAt: endsAt || null,
          players: [],
          rolePool: [],
          gameLog: [],
          accusations: [],
          scanHistory: [],
          votes: {},
          murderer: null,
          playerMessages: {}
        };
        await kv.set(key(sessionId), state);
        return ok(res, { state }, 201);
      }
      if (body.op === "join") {
        const { sessionId, name } = body;
        if (!sessionId || !name) return err(res, "sessionId and name required", 400);
        const k = key(sessionId);
        const state = await kv.get(k);
        if (!state) return err(res, "Game not found", 404);
        if (state.players.length >= state.maxPlayers) return err(res, "Session full", 409);

        const existing = state.players.find(p => p.realName.toLowerCase() === String(name).toLowerCase());
        if (existing) return ok(res, { state, player: existing });

        const player = {
          id: "A" + Math.random().toString(36).slice(2,7).toUpperCase(),
          realName: name,
          codename: "AGENT",
          cover: "Guest Operative",
          background: "", discharge: "", secret: "", oddity: "",
          perks: [], con: "", role: "innocent",
          ability: null, challengesCompleted: 0, completedChallenges: [],
          activeChallenge: null, abilityUsed: false, scanCount: 0
        };
        state.players.push(player);
        state.gameLog.push({ ts: Date.now(), message: `🚁 ${player.codename} (${player.realName}) joined` });
        await kv.set(k, state);
        return ok(res, { state, player });
      }
      return err(res, "Unknown op", 400);
    }

    return err(res, "Method not allowed", 405);
  } catch (e) {
    console.error(e);
    return err(res, e?.message || "Server error", 500);
  }
}
