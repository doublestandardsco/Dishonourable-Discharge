// /pages/api/game.js
import { kv } from '@vercel/kv';

const KEY = (id) => `game:${id}`;

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const genId = (p='game_') => (p + Math.random().toString(36).slice(2, 10)).toUpperCase();
const genSeatToken = () => {
  // human-friendly 4+4 pattern: ABCD-1234
  const A = () => Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g,'').slice(2, 6);
  return `${A()}-${A()}`;
};

async function getSession(id) { return id ? await kv.get(KEY(id)) : null; }
async function putSession(sess) {
  sess.updatedAt = Date.now();
  await kv.set(KEY(sess.id), sess);
}
async function recordLog(sess, msg) {
  sess.gameLog = sess.gameLog || [];
  sess.gameLog.push({ ts: Date.now(), msg });
}

// small built-in acts list for murderer assignment
const MURDER_ACTS = [
  'Leave one coaster upside-down at a table you visit.',
  'Say the word "almond" twice in different conversations.',
  'Tap the table twice before any drink.',
  'Hum two short notes before speaking (3+ times).',
  'Place a triangle-folded napkin somewhere conspicuous.'
];

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const id = (req.query.id || '').toUpperCase();
      const sess = await getSession(id);
      if (!sess) return res.status(404).json({ ok: false, error: 'not found' });

      // light seats view for GM panels
      const seatsLite = (sess.seats || []).map(s => ({
        token: s.token,
        claimed: !!s.playerId
      }));

      return res.json({ ok: true, session: sess, seats: seatsLite });
    }

    if (req.method !== 'POST') {
      return res.status(405).json({ ok: false, error: 'method' });
    }

    const { op } = req.body || {};
    if (op === 'ping') return res.json({ ok: true, ts: Date.now() });

    /* -------------------- CREATE -------------------- */
    if (op === 'create') {
      const sessionId = (req.body.sessionId || genId()).toUpperCase();
      const existing = await getSession(sessionId);
      if (existing) return res.status(400).json({ ok: false, error: 'session exists' });

      const limit = Math.max(1, Math.min(24, Number(req.body.playerLimit) || 6));
      const finalNightAt = Number(req.body.finalNightAt) || null;

      const seats = Array.from({ length: limit }, () => ({ token: genSeatToken(), playerId: null }));
      const sess = {
        id: sessionId,
        playerLimit: limit,
        finalNightAt,
        players: [],
        seats,
        gameLog: [],
        accusations: [],
        votes: {},
        murderer: null,          // { id, act, performedDates: [] }
        playerMessages: {},
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      await recordLog(sess, `🎮 Game created (limit ${limit})`);
      await putSession(sess);
      return res.json({
        ok: true,
        session: { id: sess.id, playerLimit: sess.playerLimit, finalNightAt: sess.finalNightAt },
        seats
      });
    }

    /* ---------------------- JOIN --------------------- */
    if (op === 'join') {
      const sessionId = (req.body.sessionId || '').toUpperCase();
      const seatTokenRaw = (req.body.seatToken || '').toUpperCase().trim();
      const playerName = (req.body.playerName || '').trim();
      const character = req.body.character || null; // client can pass the full character pack
      const abilityState = req.body.abilityState || null;

      const sess = await getSession(sessionId);
      if (!sess) return res.status(404).json({ ok: false, error: 'session not found' });

      // find the seat by token
      const seat = (sess.seats || []).find(s => (s.token || '').toUpperCase() === seatTokenRaw);
      if (!seat) return res.status(400).json({ ok: false, error: 'invalid seat key' });

      // Seat already claimed → rejoin (ignore provided name to prevent hijack)
      if (seat.playerId) {
        const existing = (sess.players || []).find(p => p.id === seat.playerId);
        if (existing) {
          await recordLog(sess, `🔁 ${existing.codename || 'OPERATIVE'} (${existing.realName}) rejoined`);
          await putSession(sess);
          return res.json({
            ok: true,
            session: { id: sess.id, playerLimit: sess.playerLimit, finalNightAt: sess.finalNightAt },
            player: existing,
            rejoined: true
          });
        }
        // stray binding? free the seat
        seat.playerId = null;
      }

      // Seat unclaimed → create the player and bind this seat
      const player = {
        id: 'agent_' + Math.random().toString(36).slice(2, 8),
        realName: playerName || 'Agent',
        ...(character || {}),
        challengesCompleted: 0,
        completedChallenges: [],
        activeChallenge: null,
        abilityUsed: false,
        scanImmunityUntil: 0
      };

      // if client didn't send a character, make a tiny placeholder
      player.codename   = player.codename   || 'OPERATIVE';
      player.cover      = player.cover      || 'Cover Identity';
      player.publicBio  = player.publicBio  || '';
      player.privateBio = player.privateBio || '';
      player.perks      = player.perks      || [];
      player.con        = player.con        || '';
      player.quirk      = player.quirk      || '';
      player.role       = player.role       || 'wildcard';
      if (abilityState) player.abilityState = abilityState;

      sess.players.push(player);
      seat.playerId = player.id;

      // Ensure exactly one murderer per session (assign as soon as there's at least 1 player; idempotent)
      if (!sess.murderer && (sess.players || []).length >= 1) {
        const picked = pick(sess.players);
        sess.murderer = { id: picked.id, act: pick(MURDER_ACTS), performedDates: [] };
        await recordLog(sess, '☠️ A secret murderer has been assigned.');
      }

      await recordLog(sess, `🚁 ${player.codename} (${player.realName}) deployed on seat ${seat.token}`);
      await putSession(sess);
      return res.json({
        ok: true,
        session: { id: sess.id, playerLimit: sess.playerLimit, finalNightAt: sess.finalNightAt },
        player
      });
    }

    /* ------------------ UPDATE PLAYER ----------------- */
    if (op === 'update_player') {
      const sessionId = (req.body.sessionId || '').toUpperCase();
      const playerId  = req.body.playerId || '';
      const patch     = req.body.patch || {};

      const sess = await getSession(sessionId);
      if (!sess) return res.status(404).json({ ok: false, error: 'session not found' });

      const idx = (sess.players || []).findIndex(p => p.id === playerId);
      if (idx < 0) return res.status(404).json({ ok: false, error: 'player not found' });

      sess.players[idx] = { ...sess.players[idx], ...patch };
      await putSession(sess);
      return res.json({ ok: true, session: { id: sess.id, playerLimit: sess.playerLimit, finalNightAt: sess.finalNightAt }, player: sess.players[idx] });
    }

    /* ----------------------- EVENT -------------------- */
    if (op === 'event') {
      const sessionId = (req.body.sessionId || '').toUpperCase();
      const msg = String(req.body.msg || '').slice(0, 2000);

      const sess = await getSession(sessionId);
      if (!sess) return res.status(404).json({ ok: false, error: 'session not found' });

      await recordLog(sess, msg);
      await putSession(sess);
      return res.json({ ok: true });
    }

    /* ----------------------- KICK --------------------- */
    if (op === 'kick') {
      // Optional GM tool: free a seat
      const sessionId = (req.body.sessionId || '').toUpperCase();
      const seatToken = (req.body.seatToken || '').toUpperCase();
      const sess = await getSession(sessionId);
      if (!sess) return res.status(404).json({ ok: false, error: 'session not found' });

      const seat = (sess.seats || []).find(s => (s.token || '').toUpperCase() === seatToken);
      if (!seat) return res.status(400).json({ ok: false, error: 'invalid seat key' });

      if (seat.playerId) {
        const idx = (sess.players || []).findIndex(p => p.id === seat.playerId);
        if (idx >= 0) sess.players.splice(idx, 1);
        seat.playerId = null;
        await recordLog(sess, `🪑 Seat ${seat.token} freed by GM`);
        await putSession(sess);
      }
      return res.json({ ok: true, session: sess });
    }

    return res.status(400).json({ ok: false, error: 'unknown op' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message || 'server error' });
  }
}
