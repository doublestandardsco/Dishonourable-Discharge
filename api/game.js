// pages/api/game.js
import { kv } from '@vercel/kv';

const KEY = id => `game:${id}`;

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  try {
    if (req.method === 'GET') {
      const id = (req.query.id || '').toUpperCase();
      if (!id) return res.status(400).json({ ok: false, error: 'Missing id' });
      const sessionJ = await kv.get(KEY(id));
      if (!sessionJ) return res.status(404).json({ ok: false, error: 'Session not found' });
      const seats = (sessionJ.seats || []).map(s => ({ token: s.token, claimed: !!s.playerId }));
      return res.status(200).json({ ok: true, session: sessionJ, seats });
    }

    const body = req.body || {};
    const op = body.op;

    if (op === 'create') {
      const id = (body.sessionId || randKey(3)).toUpperCase();
      const exists = await kv.get(KEY(id));
      if (exists) return res.status(400).json({ ok: false, error: 'Session already exists' });

      const playerLimit = Number(body.playerLimit || 6);
      const seats = Array.from({ length: playerLimit }, () => ({ token: genToken(), playerId: null }));

      const sessionJ = {
        id,
        playerLimit,
        finalNightAt: body.finalNightAt || null,
        players: [],
        gameLog: [{ ts: Date.now(), msg: `🎮 Game ${id} created (limit ${playerLimit})` }],
        seats
      };

      await kv.set(KEY(id), sessionJ);
      return res.status(200).json({
        ok: true,
        session: sessionJ,
        seats: seats.map(s => ({ token: s.token, claimed: false }))
      });
    }

    if (op === 'join') {
      const id = (body.sessionId || '').toUpperCase();
      const seatToken = (body.seatToken || '').toUpperCase();
      const playerName = (body.playerName || '').trim();

      if (!id || !seatToken) return res.status(400).json({ ok: false, error: 'Missing session or seat' });

      let sessionJ = await kv.get(KEY(id));
      if (!sessionJ) return res.status(404).json({ ok: false, error: 'Session not found' });

      const seat = (sessionJ.seats || []).find(s => s.token === seatToken);
      if (!seat) return res.status(400).json({ ok: false, error: 'Seat key invalid' });

      let player = seat.playerId ? (sessionJ.players || []).find(p => p.id === seat.playerId) : null;

      // If seat unclaimed or player record missing, create player
      if (!player) {
        const newId = 'agent_' + Math.random().toString(36).slice(2, 11);
        const character = body.character || pickCharacterForSeat(seatToken); // server assigns if not provided
        player = {
          id: newId,
          realName: playerName,
          ...character,
          abilityState: body.abilityState || { usesLeft: character.ability?.usesPerDay ?? 1, lastResetDay: dayKey() },
          missions: { active: null, count: 0 }
        };
        sessionJ.players = sessionJ.players || [];
        sessionJ.players.push(player);
        seat.playerId = player.id;

        sessionJ.gameLog = sessionJ.gameLog || [];
        sessionJ.gameLog.push({ ts: Date.now(), msg: `🚁 ${player.codename} (${player.realName || 'Unknown'}) joined` });
      } else {
        if (playerName) player.realName = playerName; // allow name update
      }

      // Ensure exactly one murderer (idempotent)
      if (!sessionJ.murdererId && (sessionJ.players || []).length > 0) {
        const chosen = sessionJ.players[Math.floor(Math.random() * sessionJ.players.length)];
        sessionJ.murdererId = chosen.id;
        sessionJ.murdererAct = pick(MURDERER_ACTS);
        sessionJ.gameLog = sessionJ.gameLog || [];
        sessionJ.gameLog.push({ ts: Date.now(), msg: '☠️ A secret murderer has been assigned.' });
      }

      await kv.set(KEY(id), sessionJ);
      return res.status(200).json({ ok: true, session: sessionJ, player });
    }

    if (op === 'update_player') {
      const id = (body.sessionId || '').toUpperCase();
      let sessionJ = await kv.get(KEY(id));
      if (!sessionJ) return res.status(404).json({ ok: false, error: 'Session not found' });

      const idx = (sessionJ.players || []).findIndex(p => p.id === body.playerId);
      if (idx < 0) return res.status(404).json({ ok: false, error: 'Player not found' });

      sessionJ.players[idx] = { ...sessionJ.players[idx], ...body.patch };
      await kv.set(KEY(id), sessionJ);
      return res.status(200).json({ ok: true, session: sessionJ, player: sessionJ.players[idx] });
    }

    if (op === 'event') {
      const id = (body.s
