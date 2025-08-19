// lib/game.ts
import { kv } from "./kv";
import { shortId } from "./ids";
import { characters, Character } from "./characters";

export type GameMeta = {
  id: string;
  maxPlayers: number;
  finalNightAt: number | null; // ms
  endsAt: number | null;       // ms (you said they’re the same; we’ll keep both props pointing to same time)
  createdAt: number;
  murderer?: { id: string; act: string };
  rolePool: string[]; // role slugs in seat order
};

export type Player = {
  id: string;            // agent code e.g. AG7X2
  realName: string;      // user-entered
  characterId: string;   // link to Character.id
  codename: string;
  aliasName: string;     // adopted in-world name
  cover: string;
  background: string;
  discharge: string;
  secret: string;
  oddity: string;
  perks: string[];
  con: string;
  role: string;          // 'flipped_agent' | 'handler' | 'wildcard' | 'innocent'
  ability: Character["ability"];
  challengesCompleted: number;
  completedChallenges: string[];
  activeChallenge: null | { id: string; text: string; reward: string };
  abilityUsed: boolean;
  scanCount: number;
  isRevealed: boolean;
  publicBio?: string;
  privateBio?: string;
};

// ---- Keys
const kMeta      = (g: string) => `game:${g}:meta`;
const kPlayers   = (g: string) => `game:${g}:players`;          // SET of playerIds
const kPlayer    = (g: string, p: string) => `game:${g}:player:${p}`;
const kLog       = (g: string) => `game:${g}:log`;              // LIST of strings
const kInbox     = (g: string, p: string) => `game:${g}:inbox:${p}`;
const kUsedChars = (g: string) => `game:${g}:usedCharacters`;   // SET of characterIds

// ---- Roles
export function buildRolePool(n: number): string[] {
  switch (n) {
    case 3: return ['flipped_agent','handler','wildcard'];
    case 4: return ['flipped_agent','handler','wildcard','wildcard'];
    case 5: return ['flipped_agent','handler','wildcard','wildcard','innocent'];
    case 6: return ['flipped_agent','handler','wildcard','wildcard','innocent','innocent'];
    default: {
      const base = ['flipped_agent','handler'];
      while (base.length < n) base.push(base.length % 2 ? 'wildcard' : 'innocent');
      return base;
    }
  }
}

export async function pushLog(gameId: string, text: string) {
  await kv.lpush(kLog(gameId), `${new Date().toLocaleTimeString()} ${text}`);
}

export async function getState(gameId: string, viewerId?: string) {
  const meta = await kv.get<GameMeta>(kMeta(gameId));
  if (!meta) return null;

  const ids = await kv.smembers<string>(kPlayers(gameId));
  const players: Player[] = [];
  for (const id of ids) {
    const p = await kv.get<Player>(kPlayer(gameId, id));
    if (p) players.push(p);
  }

  const log = await kv.lrange<string>(kLog(gameId), 0, 99);
  let inbox: any[] = [];
  if (viewerId) {
    inbox = await kv.lrange<any>(kInbox(gameId, viewerId), 0, 49);
  }

  // Public roster (what everyone can see)
  const roster = players.map(p => ({
    id: p.id,
    codename: p.codename,
    aliasName: p.aliasName,
    realName: p.realName,
    cover: p.cover,
    oddity: p.oddity,
    perks: p.perks,
    con: p.con,
    publicBio: p.publicBio || "",
  }));

  // Private view (only for the viewer)
  const me = viewerId ? players.find(p => p.id === viewerId) || null : null;

  return { meta, roster, me, log, now: Date.now() };
}

export async function createGame(opts: { id?: string; maxPlayers: number; finalNightAt?: number | null; endsAt?: number | null; }) {
  const id = (opts.id && opts.id.trim()) || shortId(6);
  const final = opts.finalNightAt ?? null;
  const meta: GameMeta = {
    id,
    maxPlayers: opts.maxPlayers,
    finalNightAt: final,
    endsAt: final, // per your note, they're the same
    createdAt: Date.now(),
    rolePool: buildRolePool(opts.maxPlayers),
  };

  // Reset/initialize structures
  await kv.del(kMeta(id), kPlayers(id), kLog(id), kUsedChars(id));
  await kv.set(kMeta(id), meta);
  await pushLog(id, `🎮 Game ${id} created. Max players: ${meta.maxPlayers}`);
  if (final) await pushLog(id, `🕛 Final Night: ${new Date(final).toLocaleString()}`);

  return meta;
}

export async function joinGame(gameId: string, realName: string) {
  const meta = await kv.get<GameMeta>(kMeta(gameId));
  if (!meta) throw new Error("Game not found");

  const currentIds = await kv.smembers<string>(kPlayers(gameId));
  if (currentIds.length >= meta.maxPlayers) throw new Error("Game is full");

  // Available characters
  const used = new Set(await kv.smembers<string>(kUsedChars(gameId)));
  const available = characters.filter(c => !used.has(c.id));
  if (!available.length) throw new Error("No characters left");

  const character = available[Math.floor(Math.random() * available.length)];
  const seatIndex = currentIds.length;
  const role = meta.rolePool[seatIndex] || 'innocent';

  // Make a unique short agent id
  let agentId = "";
  do agentId = `AG${shortId(3)}`; while (currentIds.includes(agentId));

  const p: Player = {
    id: agentId,
    realName,
    characterId: character.id,
    codename: character.codename,
    aliasName: character.aliasName ?? character.codename,
    cover: character.cover,
    background: character.background,
    discharge: character.discharge,
    secret: character.secret,
    oddity: character.oddity,
    perks: character.perks,
    con: character.con,
    role,
    ability: character.ability,
    challengesCompleted: 0,
    completedChallenges: [],
    activeChallenge: null,
    abilityUsed: false,
    scanCount: 0,
    isRevealed: false,
    publicBio: character.publicBio,
    privateBio: character.privateBio,
  };

  await kv.set(kPlayer(gameId, p.id), p);
  await kv.sadd(kPlayers(gameId), p.id);
  await kv.sadd(kUsedChars(gameId), character.id);
  await pushLog(gameId, `🚁 ${p.codename} (${p.realName}) joined`);

  return p;
}

export async function patchPlayer(gameId: string, playerId: string, patch: Partial<Player>) {
  const p = await kv.get<Player>(kPlayer(gameId, playerId));
  if (!p) throw new Error("Player not found");
  const merged: Player = { ...p, ...patch };
  await kv.set(kPlayer(gameId, playerId), merged);
  return merged;
}

export async function inbox(gameId: string, targetId: string, msg: any) {
  await kv.lpush(kInbox(gameId, targetId), { ...msg, ts: Date.now() });
}
