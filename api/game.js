// api/game.js
import { kv } from '@vercel/kv';

function json(res, code, data) {
  res.statusCode = code;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.end(JSON.stringify(data));
}

async function body(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

const K = (id) => `sess:${id}`;

async function getSession(id) { return (await kv.get(K(id))) || null; }
async function putSession(s) { await kv.set(K(s.id), s); return s; }

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

async function createSession({ id, playerLimit = 6, finalNightAt = null }) {
  if (!id) throw new Error('session id required');
  const exists = await getSession(id);
  if (exists) return exists; // idempotent
  const sess = {
    id,
    createdAt: Date.now(),
    playerLimit,
    finalNightAt,       // single gate (also “game end”)
    gamePhase: 'setup',
    players: [],
    usedCharacterIds: [],
    accusations: [],
    votes: {},
    scanHistory: [],
    logs: [],
    murderer: null      // { id, act, performedDates: [] }
  };
  await putSession(sess);
  return sess;
}

async function recordLog(sess, msg) {
  sess.logs.push({ ts: Date.now(), msg });
  if (sess.logs.length > 800) sess.logs.shift();
}

async function joinSession({ sessionId, playerName, character }) {
  const sess = await getSession(sessionId);
  if (!sess) throw new Error('session not found');
  if (sess.players.length >= (sess.playerLimit || 6)) throw new Error('session full');

  if (character?.id && sess.usedCharacterIds.includes(character.id)) {
    throw new Error('character taken');
  }

  const player = {
    id: 'agent_' + Math.random().toString(36).slice(2, 8),
    realName: playerName,
    characterId: character?.id || ('char_' + Math.random().toString(36).slice(2, 8)),
    codename: character?.codename || 'OPERATIVE',
    adoptedName: character?.adoptedName || 'Alias',
    cover: character?.cover || 'Cover Identity',
    publicBio: character?.publicBio || '',
    privateBio: character?.privateBio || '',
    perks: character?.perks || [],
    con: character?.con || '',
    quirk: character?.quirk || '',
    ability: character?.ability || null,
    role: 'wildcard',
    challengesCompleted: 0,
    completedChallenges: [],
    activeChallenge: null,
    abilityUsed: false,
    scanImmunityUntil: 0
  };

  sess.players.push(player);
  sess.usedCharacterIds.push(player.characterId);

  // Assign murderer once we have at least 3 players
  if (!sess.murderer && sess.players.length >= 3) {
    const acts = [
      'Leave one coaster upside-down at a table you visit.',
      'Say the word "almond" twice in different conversations.',
      'Tap the table twice before any drink.',
      'Hum two short notes before speaking, at least three times.',
      'Place a triangle-folded napkin somewhere conspicuous.'
    ];
    const pickPlayer = pick(sess.players);
    sess.murderer = { id: pickPlayer.id, act: pick(acts), performedDates: [] };
    await recordLog(sess, '☠️ A secret murderer has been assigned.');
  }

  await recordLog(sess, `🚁 ${player.codename} (${player.realName}) deployed`);
  await putSession(sess);
  return { session: { id: sess.id, playerLimit: sess.playerLimit, finalNightAt: sess.finalNightAt }, player };
}

async function submitAction({ sessionId, playerId, type, targetId, details }) {
  const sess = await getSession(sessionId);
  if (!sess) throw new Error('session not found');
  const me = sess.players.find(p => p.id === playerId);
  if (!me) throw new Error('player not found');
  await recordLog(sess, `📝 ${me.codename}: ${type} → ${targetId || '—'} — ${details || ''}`);
  await putSession(sess);
  return { ok: true };
}

async function useAbility({ sessionId, playerId, targetId }) {
  const sess = await getSession(sessionId);
  if (!sess) throw new Error('session not found');
  const me = sess.players.find(p => p.id === playerId);
  if (!me) throw new Error('player not found');
  if (!me.ability) throw new Error('no ability');
  if (me.abilityUsed) throw new Error('ability already used');
  me.abilityUsed = true;
  const target = sess.players.find(p => p.id === targetId);
  await recordLog(sess, `⚡ ${me.codename} used "${me.ability.name}" on ${target ? target.codename : '—'}`);
  await putSession(sess);
  return { ok: true };
}

async function drawChallenge({ sessionId, playerId, challenge }) {
  const sess = await getSession(sessionId);
  if (!sess) throw new Error('session not found');
  const me = sess.players.find(p => p.id === playerId);
  if (!me) throw new Error('player not found');

  if (me.activeChallenge) {
    await recordLog(sess, `❌ ${me.codename} failed previous mission: "${me.activeChallenge.text}"`);
  }
  me.activeChallenge = challenge || { id: 'rand_' + Date.now(), text: 'Ad-hoc mission', reward: 'Fun' };
  await recordLog(sess, `📋 New mission for ${me.codename}: "${me.activeChallenge.text}"`);
  await putSession(sess);
  return { ok: true, active: me.activeChallenge };
}

async function completeChallenge({ sessionId, playerId }) {
  const sess = await getSession(sessionId);
  if (!sess) throw new Error('session not found');
  const me = sess.players.find(p => p.id === playerId);
  if (!me) throw new Error('player not found');
  if (!me.activeChallenge) throw new Error('no active mission');

  me.challengesCompleted++;
  me.completedChallenges.push(me.activeChallenge.id);
  await recordLog(sess, `✅ ${me.codename} completed: "${me.activeChallenge.text}"`);
  me.activeChallenge = null;
  await putSession(sess);
  return { ok: true, count: me.challengesCompleted };
}

function gateOpen(sess) {
  return !!(sess.finalNightAt && Date.now() >= Number(sess.finalNightAt));
}

async function scan({ sessionId, playerId, targetId }) {
  const sess = await getSession(sessionId);
  if (!sess) throw new Error('session not found');
  if (!gateOpen(sess)) throw new Error('scans locked until final night');
  const me = sess.players.find(p => p.id === playerId);
  const target = sess.players.find(p => p.id === targetId);
  if (!me || !target) throw new Error('player not found');

  const already = sess.scanHistory.find(s => s.scanner === me.id && s.target === target.id);
  if (already) return { result: already.result, repeat: true };

  const options = [
    `Quirk check: ${target.quirk}`,
    `Behavior: ${target.con || 'no obvious tell'}`,
    `Psyche: ${pick(['high stress', 'deceptive cues', 'paranoia elevated', 'trust compromised', 'calm'])}`
  ];
  const result = pick(options);
  sess.scanHistory.push({ scanner: me.id, target: target.id, ts: Date.now(), result });
  await recordLog(sess, `🔍 ${me.codename} scanned ${target.codename}: ${result}`);
  await putSession(sess);
  return { result };
}

async function accuse({ sessionId, playerId, targetId }) {
  const sess = await getSession(sessionId);
  if (!sess) throw new Error('session not found');
  if (!gateOpen(sess)) throw new Error('accusations locked until final night');
  const me = sess.players.find(p => p.id === playerId);
  const target = sess.players.find(p => p.id === targetId);
  if (!me || !target) throw new Error('player not found');

  sess.accusations.push({ accuser: me.id, accused: target.id, ts: Date.now() });
  await recordLog(sess, `🚨 FORMAL ACCUSATION: ${me.codename} → ${target.codename}`);
  await putSession(sess);
  return { ok: true };
}

async function vote({ sessionId, playerId, suspectId }) {
  const sess = await getSession(sessionId);
  if (!sess) throw new Error('session not found');
  if (!gateOpen(sess)) throw new Error('voting locked until final night');
  sess.votes[playerId] = suspectId;
  await recordLog(sess, `🗳️ Vote cast: ${playerId} → ${suspectId}`);
  await putSession(sess);
  return { ok: true };
}

async function setFinalNight({ sessionId, finalNightAt }) {
  const sess = await getSession(sessionId);
  if (!sess) throw new Error('session not found');
  sess.finalNightAt = finalNightAt ? Number(finalNightAt) : null;
  await recordLog(sess, `🕛 Final Night set → ${sess.finalNightAt || 'unset'}`);
  await putSession(sess);
  return { ok: true, finalNightAt: sess.finalNightAt };
}

function sanitize(sess) {
  // send full session (client decides what to show); keep as-is for simplicity
  return sess;
}

export default async function handler(req, res) {
  try {
    if (req.method === 'OPTIONS') return json(res, 200, { ok: true });

    const url = new URL(req.url, 'http://x');
    const op = (url.searchParams.get('op') || '').toLowerCase();

    if (req.method === 'GET') {
      if (op === 'ping') return json(res, 200, { ok: true, ts: Date.now() });
      if (op === 'state') {
        const id = url.searchParams.get('id');
        const sess = id ? await getSession(id) : null;
        if (!sess) return json(res, 404, { ok: false, error: 'not found' });
        return json(res, 200, sanitize(sess));
      }
      return json(res, 404, { ok: false, error: 'no route' });
    }

    // POST operations
    const b = await body(req);

    switch (b.op) {
      case 'create':   return json(res, 200, await createSession(b));
      case 'join':     return json(res, 200, await joinSession(b));
      case 'submit':   return json(res, 200, await submitAction(b));
      case 'ability':  return json(res, 200, await useAbility(b));
      case 'draw':     return json(res, 200, await drawChallenge(b));
      case 'complete': return json(res, 200, await completeChallenge(b));
      case 'scan':     return json(res, 200, await scan(b));
      case 'accuse':   return json(res, 200, await accuse(b));
      case 'vote':     return json(res, 200, await vote(b));
      case 'setfinal': return json(res, 200, await setFinalNight(b));
      default:         return json(res, 400, { ok: false, error: 'unknown op' });
    }
  } catch (e) {
    return json(res, 400, { ok: false, error: e.message || String(e) });
  }
}
