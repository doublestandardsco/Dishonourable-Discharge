// /api/game.js
import { kv } from '@vercel/kv';

export const config = { runtime: 'nodejs' };

/* ---------- helpers ---------- */
const now = () => Date.now();
const newId = (p = 'A') => (p + Math.random().toString(36).slice(2, 8)).toUpperCase();

function assignRoles(n) {
  let pool = [];
  if (n <= 3) pool = ['flipped_agent', 'handler', 'wildcard'];
  else if (n === 4) pool = ['flipped_agent', 'handler', 'wildcard', 'wildcard'];
  else if (n === 5) pool = ['flipped_agent', 'handler', 'wildcard', 'wildcard', 'innocent'];
  else if (n === 6) pool = ['flipped_agent', 'handler', 'wildcard', 'wildcard', 'innocent', 'innocent'];
  else {
    // expand to 12
    pool = ['flipped_agent', 'handler', 'wildcard', 'wildcard', 'innocent', 'innocent',
            'wildcard', 'innocent', 'innocent', 'wildcard', 'innocent', 'innocent'];
  }
  // shuffle
  return pool.sort(() => Math.random() - 0.5);
}

const roles = {
  flipped_agent: { name: 'The Flipped Agent', objective: 'Stay hidden and sow chaos.', winCondition: 'Survive the vote OR flip someone.' },
  handler:       { name: 'The Handler',       objective: 'Uncover the traitor.',       winCondition: 'Correctly identify Flipped Agent.' },
  wildcard:      { name: 'The Wildcard',      objective: 'Survive & adapt.',           winCondition: 'Align with winners or finish solo goals.' },
  innocent:      { name: 'Innocent Operative',objective: 'Survive and deduce.',        winCondition: 'Vote out Flipped Agent or live.' }
};

/* ---------- 12 characters (short to keep file reasonable; extend as you like) ---------- */
const characters = [
  { id:"lacehunter", codename:"LACEHUNTER", cover:"Luxury Skiwear Designer",
    background:"Ex–French AF comms → NATO PSYOPS ‘tactical glam tech’.",
    discharge:"Morale incident with glitter & thermals.",
    publicBio:"Runway tyrant turned field stylist. Cares too much about angles.",
    perks:["Honorific Lock: must be addressed as “Monsieur Val”.","Style Verdict: on 'Runway check' target holds a 10s pose."],
    con:"If he sees his reflection he must preen for 3s.",
    ability:{ name:"Fashion Emergency", desc:"Force any two players to swap one visible clothing item.", uses:1 }
  },
  { id:"snowblind", codename:"SNOWBLIND", cover:"Extreme Sports Photographer",
    background:"RFMF (Fiji) recon tracker. Tracks rumour & happy hour.",
    discharge:"Honourable; refused to track an innocent defector.",
    publicBio:"Whispers like radio; lives for powder and gossip.",
    perks:["Breadcrumb Command: pick a trigger word; speakers owe a clue.","Switchback: say 'First tracks' → rotate seats; last seated owes favour."],
    con:"If someone says 'ohana/family' he must deliver a one-line lesson.",
    ability:{ name:"Hire a Tail", desc:"Recruit a player to shadow you 10–30 min and report intel.", uses:1 }
  },
  { id:"frostbite", codename:"FROSTBITE", cover:"Adventure Safety Coordinator",
    background:"Polish GROM; cold weather & interrogations.",
    discharge:"Honourable; ‘cultural differences’.",
    publicBio:"Treats small talk like debriefings; fist-bumps only.",
    perks:["Interrogator’s Pause: on 'Answer the question' reply ≤5 words.","Cold Protocol: greetings are fist-bump only."],
    con:"When asked 'what’s the plan?' must produce a checklist—or salute and say 'Improvise'.",
    ability:{ name:"Coerce an Asset", desc:"Make a player your Asset 15 min; finish 2 tasks.", uses:1 }
  },
  { id:"blackrun", codename:"BLACKRUN", cover:"Avalanche Risk Specialist",
    background:"Indian Para (SF) mountain ops.",
    discharge:"Medical; survived catastrophic slide.",
    publicBio:"Predicts social avalanches. Taps twice to reset talk.",
    perks:["Beacon Check: all phones face-down 5 min.","Disaster Brief: two table taps resets topic & picks next speaker."],
    con:"Seeing triangles/angles makes her estimate degrees aloud.",
    ability:{ name:"Avalanche Protocol", desc:"30s evac drill: swap seats & surrender a small item; you redistribute.", uses:1 }
  },
  { id:"powder_keg", codename:"POWDER KEG", cover:"Lodge Event Coordinator",
    background:"Spanish social engineer; dramatic diplomacy.",
    discharge:"Dishonourable—receptions & weapons.",
    publicBio:"Lives for guest lists and chaos.",
    perks:["VIP Gate: others must introduce you with a grand title.","Guest List: say 'You’re on the list' → 2-min private task brief."],
    con:"On any rumour she must say 'exclusive source' + wink; later confess 'It was me'.",
    ability:{ name:"Task the Mark", desc:"Nominate a player to get a number/key/selfie within 20 min.", uses:1 }
  },
  { id:"icepick", codename:"ICEPICK", cover:"Artisanal Spirits Consultant",
    background:"Ex-Spetsnaz interrogator (allegedly defected).",
    discharge:"Sochi era 'defection'… maybe.",
    publicBio:"Answers 'roger'; ends with 'over'. Toasts are law.",
    perks:["Cold Stare: on eye contact the other must break first.","Vodka Toast Override: on cue all must toast; 30s to procure alcohol or penalty."],
    con:"On new arrivals he pats pockets 'ID, keys, exit—roger'; if caught skipping: 10s bug sweep.",
    ability:{ name:"Charm Offensive (vodka)", desc:"Compel 3 people to buy you vodka drinks before midnight.", uses:1 }
  },
  { id:"switchback", codename:"SWITCHBACK", cover:"Lift Operations Planner",
    background:"Norwegian Home Guard logistics savant.",
    discharge:"Budget fight turned frost-bitten walkout.",
    publicBio:"Replans everything including your bathroom breaks.",
    perks:["Reroute: command a table reshuffle.","Queue Cut: once per hour, move yourself to front of any line (group game only)."],
    con:"If anyone says 'schedule' must pull out a pen and draw a mini-Gantt.",
    ability:{ name:"Logistics Surge", desc:"For 10 min you assign seats and speaking order.", uses:1 }
  },
  { id:"sleet", codename:"SLEET", cover:"Sound Tech for Après DJs",
    background:"Signals intel dropout; too much bass, not enough orders.",
    discharge:"Went AWOL to follow a DJ tour.",
    publicBio:"Communicates in hand-signals & drops.",
    perks:["Mic Check: on cue others must speak in radio alphabet.","Drop It: shout 'Bass' and everyone freezes for 3 seconds."],
    con:"If someone claps on 1 & 3, must correct them with a demo.",
    ability:{ name:"Feedback Loop", desc:"Pick a target: they must end every sentence with 'over' for 10 min.", uses:1 }
  },
  { id:"whiteout", codename:"WHITEOUT", cover:"Wellness & Breathwork Coach",
    background:"Ex-military medic; oxygen wizard.",
    discharge:"'Irreconcilable vibe differences.'",
    publicBio:"Breathes at you until you calm down.",
    perks:["Box Breathing: on cue the table inhales/exhales for 16 counts.","Hydration Drill: everyone sips now—no excuses."],
    con:"If anyone yawns, must lead a 10-sec guided reset.",
    ability:{ name:"O2 Advantage", desc:"For 5 min you can silence any chatter with a breath count.", uses:1 }
  },
  { id:"grindel", codename:"GRINDEL", cover:"Ski Rental Fixer",
    background:"Black-market gear broker turned 'legit'.",
    discharge:"Inventory 'misunderstanding'.",
    publicBio:"Can procure anything with two zips and a buckle.",
    perks:["Bind Check: call it and someone must re-lace or adjust gear.","Sticker Tax: hands out a sticker; wearer buys first round."],
    con:"If offered a receipt, must refuse with a story about 'paper trails'.",
    ability:{ name:"Grey Market Pull", desc:"Summon a prop (hat/scarf/lanyard) others must wear 15 min.", uses:1 }
  },
  { id:"yodel", codename:"YODEL", cover:"Ski School Hype Captain",
    background:"Swiss reservist morale NCO.",
    discharge:"Too loud, too happy.",
    publicBio:"Speaks in slogans; yodels if cornered.",
    perks:["Call & Response: yell a slogan; group must echo.","Photo Op: command a 10-sec awkward pose."],
    con:"Must high-five any raised hand within reach.",
    ability:{ name:"Hype Storm", desc:"Pick a target to lead a chant for 30 seconds.", uses:1 }
  },
  { id:"carve", codename:"CARVE", cover:"Blade-Sharpening Influencer",
    background:"Chef-turned-operative; edges everything.",
    discharge:"Too many sharpeners in checked luggage.",
    publicBio:"Makes metaphorical cuts in conversations.",
    perks:["Edge Call: declare 'sharp take' and someone must give a hot take in 10 words.","Slice & Dice: split a group into teams instantly."],
    con:"If anyone says 'dull', must offer a sharpening tip aloud.",
    ability:{ name:"Cut Scene", desc:"Hard cut the topic; you pick the next subject and speaker order.", uses:1 }
  }
];

const murdererActs = [
  "Leave one coaster upside-down at a table you visit.",
  "Say the word 'almond' twice in different conversations.",
  "Touch the back of a chair before sitting, every time.",
  "Hum two short notes before speaking, at least three times.",
  "Place a napkin folded into a triangle at a random spot.",
  "Tap the table twice before drinking."
];

/* ---------- state helpers ---------- */
function baseState(sessionId, playerLimit, finalNightAt) {
  return {
    sessionId,
    playerLimit,
    finalNightAt,
    players: [],
    rolePool: assignRoles(playerLimit),
    gamePhase: 'setup',
    gameLog: [],
    accusations: [],
    votes: {},
    scanHistory: [],
    playerMessages: {},
    murderer: null,
    createdAt: now()
  };
}

function pickMurderer(state) {
  if (state.murderer || state.players.length < 3) return;
  const p = state.players[Math.floor(Math.random() * state.players.length)];
  const act = murdererActs[Math.floor(Math.random() * murdererActs.length)];
  state.murderer = { id: p.id, act, performedDates: [] };
  state.gameLog.push({ ts: now(), msg: '☠️ A secret murderer has been assigned.' });
}

/* ---------- API ---------- */
export default async function handler(req, res) {
  try {
    const { searchParams } = new URL(req.url, 'http://localhost');
    const op = (searchParams.get('op') || '').toLowerCase();

    if (req.method === 'POST' && op === 'create') {
      const body = await readJSON(req);
      const { sessionId, playerLimit = 6, finalNightAt } = body || {};
      if (!sessionId) return json(res, 400, { error: 'sessionId required' });

      const exists = await kv.get(`game:${sessionId}`);
      const state = baseState(sessionId, Number(playerLimit), finalNightAt || null);
      // wipe if existed
      await kv.set(`game:${sessionId}`, state);
      return json(res, 200, { ok: true, state });
    }

    if (req.method === 'GET' && op === 'get') {
      const sessionId = searchParams.get('sessionId');
      const playerId = searchParams.get('playerId') || null;
      if (!sessionId) return json(res, 400, { error: 'sessionId required' });
      const state = await kv.get(`game:${sessionId}`);
      if (!state) return json(res, 404, { error: 'Game not found' });

      // hide murderer directive unless requester is the murderer
      const sanitized = { ...state };
      if (sanitized.murderer && sanitized.murderer.id !== playerId) {
        sanitized.murderer = { exists: true };
      }
      return json(res, 200, { ok: true, state: sanitized });
    }

    if (req.method === 'POST' && op === 'join') {
      const body = await readJSON(req);
      const { sessionId, name } = body || {};
      if (!sessionId || !name) return json(res, 400, { error: 'sessionId and name required' });

      const state = await kv.get(`game:${sessionId}`);
      if (!state) return json(res, 404, { error: 'Game not found' });

      if (state.players.length >= state.playerLimit) {
        return json(res, 400, { error: 'Session full' });
      }

      // select unused character
      const used = new Set(state.players.map(p => p.characterId));
      const available = characters.filter(c => !used.has(c.id));
      if (!available.length) return json(res, 400, { error: 'No characters left' });

      const character = available[Math.floor(Math.random() * available.length)];
      const roleIndex = state.players.length;
      const assignedRole = state.rolePool[roleIndex] || 'innocent';

      const player = {
        id: newId('AG_'),
        realName: name,
        codeName: character.codename,
        characterId: character.id,
        cover: character.cover,
        background: character.background,
        discharge: character.discharge,
        publicBio: character.publicBio,
        perks: character.perks || [],
        con: character.con || '',
        role: assignedRole,
        ability: { ...character.ability, used: false },
        challengesCompleted: 0,
        completedChallenges: [],
        activeChallenge: null,
        scanCount: 0
      };

      state.players.push(player);
      if (!state.playerMessages[player.id]) state.playerMessages[player.id] = [];
      state.gameLog.push({ ts: now(), msg: `🚁 ${player.codeName} (${player.realName}) joined.` });

      await kv.set(`game:${sessionId}`, state);
      pickMurderer(state);
      // return fresh with possible murderer assignment
      await kv.set(`game:${sessionId}`, state);
      return json(res, 200, { ok: true, player, state });
    }

    if (req.method === 'POST' && op === 'action') {
      const body = await readJSON(req);
      const { sessionId, playerId, type, targetId, details } = body || {};
      if (!sessionId || !playerId || !type) return json(res, 400, { error: 'missing fields' });

      const state = await kv.get(`game:${sessionId}`);
      if (!state) return json(res, 404, { error: 'Game not found' });

      const me = state.players.find(p => p.id === playerId);
      if (!me) return json(res, 404, { error: 'Player not found' });

      const target = state.players.find(p => p.id === targetId);
      const label = target ? `${target.codeName} (${target.realName})` : '—';
      const text = `${type.toUpperCase()}: ${me.codeName} → ${label} — ${details || '(no details)'}`;
      state.gameLog.push({ ts: now(), msg: `📝 ${text}` });

      if (target) {
        if (!state.playerMessages[target.id]) state.playerMessages[target.id] = [];
        state.playerMessages[target.id].push({ from: me.codeName, type, text: details || '', ts: now() });
      }

      await kv.set(`game:${sessionId}`, state);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && op === 'ability') {
      const body = await readJSON(req);
      const { sessionId, playerId, targetId } = body || {};
      const state = await kv.get(`game:${sessionId}`);
      if (!state) return json(res, 404, { error: 'Game not found' });

      const me = state.players.find(p => p.id === playerId);
      if (!me) return json(res, 404, { error: 'Player not found' });
      if (me.ability?.used) return json(res, 400, { error: 'Ability already used' });

      const target = state.players.find(p => p.id === targetId);
      const tLabel = target ? `${target.codeName} (${target.realName})` : '—';
      me.ability.used = true;

      state.gameLog.push({ ts: now(), msg: `⚡ ${me.codeName} used "${me.ability.name}" on ${tLabel}` });
      if (target) {
        if (!state.playerMessages[target.id]) state.playerMessages[target.id] = [];
        state.playerMessages[target.id].push({ from: me.codeName, type: 'Ability', text: me.ability.desc, ts: now() });
      }

      await kv.set(`game:${sessionId}`, state);
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { error: 'Unknown route' });
  } catch (err) {
    return json(res, 500, { error: String(err?.message || err) });
  }
}

async function readJSON(req) {
  const txt = await streamToString(req);
  try { return JSON.parse(txt || '{}'); } catch { return {}; }
}
function streamToString(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}
function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}
