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

export d
