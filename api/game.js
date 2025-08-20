// /api/game.js
import { kv } from '@vercel/kv';

const KEY = (id) => `game:${id}`;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const genId = (p = 'game_') => (p + Math.random().toString(36).slice(2, 10)).toUpperCase();
const genSeatToken = () => {
  // human-friendly 4+4 pattern: ABCD-1234
  const A = () => Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(2, 6);
  return `${A()}-${A()}`;
};

async function getSession(id) { return id ? await kv.get(KEY(id)) : null; }
async function putSession(sess) { sess.updatedAt = Date.now(); await kv.set(KEY(sess.id), sess); }
function recordLog(sess, msg) {
  sess.gameLog = sess.gameLog || [];
  sess.gameLog.push({ ts: Date.now(), msg });
}

const MURDER_ACTS = [
  'Leave one coaster upside-down at a table you visit.',
  'Say the word "almond" twice in different conversations.',
  'Tap the table twice before any drink.',
  'Hum two short notes before speaking (3+ times).',
  'Place a triangle-folded napkin somewhere conspicuous.'
];

function ensureMurderer(sess) {
  // drop stale murderer
  if (sess.murderer && !sess.players.find(p => p.id === sess.murderer.id)) {
    sess.murderer = null;
  }
  // guarantee exactly one once there are 3+ players
  if (!sess.murderer && (sess.players?.length || 0) >= 3) {
    const picked = pick(sess.players);
    sess.murderer = { id: picked.id, act: pick(MURDER_ACTS), performedDates: [] };
    recordLog(sess, '☠️ A secret murderer has been assigned.');
  }
}

export default async function handler(req, res) {
  try {
    if (req.method === 'GET') {
      const id = (req.query.id || '').toUpperCase();
      const sess = await getSession(id);
      if (!sess) return res.status(404).json({ ok: false, error: 'not found' });
      ensureMurderer(sess);            // keep invariant
      await putSession(sess);
      return res.json({ ok: true, session: sess });
    }

    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method' });

    const { op } = req.body || {};
    if (op === 'ping') return res.json({ ok: true, ts: Date.now() });

    if (op === 'create') {
      const sessionId = (req.body.sessionId || genId()).toUpperCase();
      const limit = Math.max(1, Math.min(24, Number(req.body.playerLimit) || 6));
      const finalNightAt = Number(req.body.finalNightAt) || null;

      // prevent clobber
      const exists = await getSession(sessionId);
      if (exists) return res.status(400).json({ ok: false, error: 'session exists' });

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
        murderer: null,
        playerMessages: {},
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
      recordLog(sess, `🎮 Game created (limit ${limit})`);
      await putSession(sess);
      return res.json({
        ok: true,
        session: { id: sess.id, playerLimit: sess.playerLimit, finalNightAt: sess.finalNightAt },
        seats
      });
    }

    if (op === 'join') {
      const sessionId = (req.body.sessionId || '').toUpperCase();
      const seatTokenRaw = (req.body.seatToken || '').toUpperCase().trim();
      const playerName = (req.body.playerName || '').trim();
      const character = req.body.character || null; // full character pack from client
      const abilityState = req.body.abilityState || null;

      const sess = await getSession(sessionId);
      if (!sess) return res.status(404).json({ ok: false, error: 'session not found' });

      const seat = (sess.seats || []).find(s => (s.token || '').toUpperCase() === seatTokenRaw);
      if (!seat) return res.status(400).json({ ok: false, error: 'invalid seat key' });

      // Rejoin
      if (seat.playerId) {
        const existing = (sess.players || []).find(p => p.id === seat.playerId);
        if (existing) {
          recordLog(sess, `🔁 ${existing.codename || 'OPERATIVE'} (${existing.realName}) rejoined`);
          ensureMurderer(sess);
          await putSession(sess);
          return res.json({
            ok: true,
            session: { id: sess.id, playerLimit: sess.playerLimit, finalNightAt: sess.finalNightAt, seats: sess.seats },
            player: existing,
            rejoined: true
          });
        }
        seat.playerId = null; // stale binding
      }

      // Fresh join
      const player = {
        id: 'agent_' + Math.random().toString(36).slice(2, 8),
        realName: playerName || 'Agent',
        ...(character || {}),
        abilityState: abilityState || null,
        challengesCompleted: 0,
        completedChallenges: [],
        activeChallenge: null,
        abilityUsed: false,
        scanImmunityUntil: 0
      };

      // sane fallbacks
      player.codename = player.codename || 'OPERATIVE';
      player.cover = player.cover || 'Cover Identity';
      player.publicBio = player.publicBio || '';
      player.privateBio = player.privateBio || '';
      player.perks = player.perks || [];
      player.con = player.con || '';
      player.quirk = player.quirk || '';
      player.role = player.role || 'wildcard';

      sess.players.push(player);
      seat.playerId = player.id;

      ensureMurderer(sess);
      recordLog(sess, `🚁 ${player.codename} (${player.realName}) deployed on seat ${seat.token}`);
      await putSession(sess);

      return res.json({
        ok: true,
        session: { id: sess.id, playerLimit: sess.playerLimit, finalNightAt: sess.finalNightAt, seats: sess.seats },
        player
      });
    }

    if (op === 'kick') {
      const sessionId = (req.body.sessionId || '').toUpperCase();
      const seatToken = (req.body.seatToken || '').toUpperCase();
      const sess = await getSession(sessionId);
      if (!sess) return res.status(404).json({ ok: false, error: 'session not found' });

      const seat = (sess.seats || []).find(s => (s.token || '').toUpperCase() === seatToken);
      if (!seat) return res.status(400).json({ ok: false, error: 'invalid seat key' });

      if (seat.playerId) {
        const idx = sess.players.findIndex(p => p.id === seat.playerId);
        if (idx >= 0) sess.players.splice(idx, 1);
        seat.playerId = null;
        recordLog(sess, `🪑 Seat ${seat.token} freed by GM`);
      }
      ensureMurderer(sess);
      await putSession(sess);
      return res.json({ ok: true, session: sess });
    }

    // NEW: append to game log from clients
    if (op === 'event') {
      const sessionId = (req.body.sessionId || '').toUpperCase();
      const msg = String(req.body.msg || '').slice(0, 500);
      const sess = await getSession(sessionId);
      if (!sess) return res.status(404).json({ ok: false, error: 'session not found' });
      recordLog(sess, msg);
      await putSession(sess);
      return res.json({ ok: true });
    }

    // NEW: update one player (for missions, ability uses, etc.)
    if (op === 'update_player') {
      const sessionId = (req.body.sessionId || '').toUpperCase();
      const playerId = req.body.playerId || '';
      const patch = req.body.patch || {};
      const sess = await getSession(sessionId);
      if (!sess) return res.status(404).json({ ok: false, error: 'session not found' });
      const p = (sess.players || []).find(x => x.id === playerId);
      if (!p) return res.status(404).json({ ok: false, error: 'player not found' });

const allowed = new Set([
  // state
  'abilityState', 'missions',
  'challengesCompleted', 'completedChallenges', 'activeChallenge',
  'abilityUsed', 'scanImmunityUntil',

  // identity / display
  'realName', 'adoptedName', 'alias', 'codename',

  // character pack
  'cover', 'publicBio', 'privateBio', 'background', 'discharge',
  'secretMission', 'perks', 'quirk', 'con', 'ability', 'role'
]);
      for (const k of Object.keys(patch)) if (allowed.has(k)) p[k] = patch[k];

      await putSession(sess);
      return res.json({ ok: true, player: p });
    }

    return res.status(400).json({ ok: false, error: 'unknown op' });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: e.message || 'server error' });
  }
}
