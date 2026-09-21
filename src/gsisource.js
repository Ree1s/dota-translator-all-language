// The GSI source: chat from Dota's own Game State Integration feed.
//
// Dota POSTs its state to a local address named in a cfg file the player
// owns (src/gsiconfig.js writes it), and since GSI version 48 at the latest
// the `events` section carries chat. SEEN 2026-09-21, live games and replays:
//
//   { "game_time": 79, "event_type": "chat_message", "player_id": 0,
//     "channel_type": 11, "message": "..." }
//
// channel_type 11 is all chat, 12 allies. Nothing of the game is opened or
// read for this: it is Valve's documented feed, and the game does the
// sending. What it does NOT say is who player 8 is - a PLAYER's payload
// names only themselves (a spectator's names everybody) - so a speaker the
// feed cannot name is called by their slot's colour, as players do anyway.
//
// The same onMessage({name, text, channel, slot, hero}) as memsource.js, so
// nothing after the source knows the difference.

import http from 'node:http';
import { needsTranslation } from './chatlog.js';

export const GSI_PORT = 47854;

// What Dota calls the ten slots' colours; the overlay paints the name in it.
export const SLOT_NAMES = ['Blue', 'Teal', 'Purple', 'Yellow', 'Orange', 'Pink', 'Olive', 'Light Blue', 'Green', 'Brown'];

const CHANNEL_TYPES = { 11: 'all', 12: 'team' };

const EMOTICONS = new RegExp('[' + String.fromCharCode(0xE000) + '-' + String.fromCharCode(0xF8FF) + ']', 'g');

const shortHero = (name) => {
  const m = /^npc_dota_hero_([a-z_]{2,40})$/.exec(String(name || ''));
  return m ? m[1] : null;
};

function ownSeat(player) {
  if (Number.isInteger(player.team_slot) && player.team_slot >= 0 && player.team_slot < 5) {
    if (player.team_name === 'radiant') return player.team_slot;
    if (player.team_name === 'dire') return 5 + player.team_slot;
  }
  return Number.isInteger(player.player_slot) ? player.player_slot : null;
}

/**
 * Who is in which slot, as far as this payload says.
 * A player's payload: `player` and `hero` are their own, flat.
 * A spectator's: player.team2.player0..4 / team3.player5..9, hero likewise.
 * Returns Map(slot -> {name, hero}).
 */
export function readRoster(data) {
  const roster = new Map();
  const player = data && data.player, hero = data && data.hero;
  if (!player || typeof player !== 'object') return roster;
  // The player's own SEAT - the number their chat events carry and the game
  // colours them by - is their team plus team_slot. NOT player_slot: SEEN in
  // a matchmade game, radiant, team_slot 4, chat player_id 4, orange in the
  // game - and player_slot 5.
  const seat = ownSeat(player);
  if (seat !== null && typeof player.name === 'string') {
    roster.set(seat, { name: player.name, hero: shortHero(hero && hero.name) });
    return roster;
  }
  for (const team of Object.keys(player)) {
    if (!/^team\d+$/.test(team) || !player[team] || typeof player[team] !== 'object') continue;
    for (const key of Object.keys(player[team])) {
      const m = /^player(\d+)$/.exec(key);
      const p = player[team][key];
      if (!m || !p || typeof p.name !== 'string') continue;
      const h = hero && hero[team] && hero[team][key];
      roster.set(Number(m[1]), { name: p.name, hero: shortHero(h && h.name) });
    }
  }
  return roster;
}

// Dota's JSON is sometimes malformed around events (SEEN: two events run
// together in one object). An event rides along for ~30 payloads, so one
// bad payload loses nothing - but when the whole body will not parse, the
// chat is still dug out of the text.
const CHAT_IN_TEXT = /"game_time":\s*(-?\d+),\s*"event_type":\s*"chat_message",\s*"player_id":\s*(\d+),\s*"channel_type":\s*(\d+),\s*"message":\s*("(?:[^"\\]|\\.)*")/g;

/**
 * Decode one POST body. Returns {matchid, roster, chat: [{gameTime, slot,
 * channelType, text}]}, oldest first; null for something that is not GSI.
 */
export function readGsiPayload(body) {
  const raw = String(body || '');
  let data = null;
  try { data = JSON.parse(raw); } catch { /* dug out below */ }
  const chat = [];
  if (data && typeof data === 'object') {
    for (const e of Array.isArray(data.events) ? data.events : []) {
      if (!e || e.event_type !== 'chat_message' || typeof e.message !== 'string') continue;
      if (!Number.isInteger(e.player_id)) continue;
      chat.push({ gameTime: Number(e.game_time) || 0, slot: e.player_id, channelType: e.channel_type, text: e.message });
    }
  } else {
    if (!raw.includes('"provider"')) return null;
    for (const m of raw.matchAll(CHAT_IN_TEXT)) {
      let text;
      try { text = JSON.parse(m[4]); } catch { continue; }
      chat.push({ gameTime: Number(m[1]), slot: Number(m[2]), channelType: Number(m[3]), text });
    }
  }
  // The list is newest first; say them in the order they were said.
  chat.sort((a, b) => a.gameTime - b.gameTime);
  const matchid = data && data.map && typeof data.map.matchid === 'string' ? data.map.matchid : '';
  // The local player's Steam id (a player's payload only; a spectator's has ten).
  const steamid = data && data.player && typeof data.player.steamid === 'string' && /^\d{5,20}$/.test(data.player.steamid) ? data.player.steamid : '';
  return { matchid, roster: data ? readRoster(data) : new Map(), chat, steamid };
}

/**
 * Turns payloads into new lines. An event is in every payload for half a
 * minute, so each is said once; and whatever is in the FIRST payload was
 * said before the app was looking, and is remembered without being shown -
 * the same priming rule the memory reader follows.
 */
export function createGsiChat({ scripts = ['cyrillic'], onMessage = () => {}, onUnknownChannel = () => {}, identify = null, onSteamId = () => {} } = {}) {
  let steamid = '';
  let seen = new Set();
  let matchid = null;
  let primed = false;
  const roster = new Map();
  const unknown = new Set();
  // Lines are said in the order they came, also when one waits for a grab.
  let queue = Promise.resolve();

  // The feed gives a speaker's seat, never their hero. The game's own chat
  // shows it: `identify` (src/rowgrab.js) looks at the portrait beside the
  // game's NEWEST chat row. MEASURED: 16 of 16 grabs right over a whole
  // match. Only when this payload brought exactly ONE new line - with two,
  // the newest row is the second one's - and an emoticon is a row too.
  const learning = new Map();     // seat -> the grab under way for it
  const hinted = new Map();       // ... as one grab has said so far
  const seatOf = new Map();       // the feed's number -> the seat it really is, where they differ
  const learn = (slot, forMatch) => {
    if (!learning.has(slot)) learning.set(slot, look(slot, forMatch).finally(() => learning.delete(slot)));
    return learning.get(slot);
  };
  const look = async (slot, forMatch) => {
    let found = null;
    try { found = await identify(slot); } catch { /* unnamed, as before */ }
    if (!found || forMatch !== matchid) return;
    // One hero, one seat. A hero already known in ANOTHER seat, seen in the
    // speaker's own chat row, says the feed's number is not their seat: in a
    // lobby with bots chat ids follow join order (SEEN 2026-09-22: the user,
    // purple in seat 2, arrived as player 0 and was called Blue). The line is
    // that seat's - name, hero and colour. The top bar looks at the seat the
    // NUMBER names, so it cannot say this and is not believed here.
    for (const [other, who] of roster) {
      if (other === slot || who.hero !== found.hero) continue;
      // Once could be the race the rule was made for (the newest row being
      // somebody else's): believed when a second grab says the same.
      if (found.from !== 'top') {
        if (hinted.get(slot) === other) seatOf.set(slot, other);
        else hinted.set(slot, other);
      }
      return;
    }
    roster.set(slot, { ...roster.get(slot), hero: found.hero });
  };

  return {
    // Resolves when everything heard so far has been said (for tests).
    idle: () => queue,
    payload(body) {
      const p = readGsiPayload(body);
      if (!p) return false;
      if (p.steamid && p.steamid !== steamid) { steamid = p.steamid; onSteamId(steamid); }
      if (p.matchid !== matchid) {
        // Another match: other people in the slots, and its chat is all new.
        if (matchid !== null) { seen = new Set(); roster.clear(); seatOf.clear(); hinted.clear(); }
        matchid = p.matchid;
      }
      for (const [slot, who] of p.roster) roster.set(slot, { ...roster.get(slot), ...who, hero: who.hero || (roster.get(slot) || {}).hero || null });
      const fresh = p.chat.filter((c) => !seen.has(c.gameTime + '|' + c.slot + '|' + c.channelType + '|' + c.text)).length;
      for (const c of p.chat) {
        const key = c.gameTime + '|' + c.slot + '|' + c.channelType + '|' + c.text;
        if (seen.has(key)) continue;
        seen.add(key);
        if (!primed) continue;
        // An emoticon is a character from Unicode's private use area (SEEN:
        // U+E0B8 as a whole message); a line of nothing else is not a line.
        const text = c.text.replace(EMOTICONS, '').trim();
        // Any line is a chance to learn its speaker's hero, English too.
        const grab = identify && (fresh === 1 || learning.has(c.slot)) && !(roster.get(c.slot) || {}).hero && !seatOf.has(c.slot) ? learn(c.slot, matchid) : null;
        if (!text) continue;
        let channel = CHANNEL_TYPES[c.channelType];
        if (!channel) {
          // Shown rather than lost, and said once: only 11 and 12 have been seen.
          if (!unknown.has(c.channelType)) { unknown.add(c.channelType); onUnknownChannel(c.channelType); }
          channel = 'all';
        }
        if (!needsTranslation(text, scripts)) continue;
        const say = () => {
          const seat = seatOf.has(c.slot) ? seatOf.get(c.slot) : c.slot;
          const who = roster.get(seat) || {};
          onMessage({ name: who.name || SLOT_NAMES[seat] || 'Player ' + seat, text, channel, slot: seat, ...(who.hero ? { hero: who.hero } : {}) });
        };
        if (!identify) say();
        else queue = queue.then(() => grab).then(say, say);
      }
      primed = true;
      if (seen.size > 5000) seen = new Set([...seen].slice(-1000));
      return true;
    },
  };
}

/**
 * Listen for Dota's payloads. Same handle as startMemorySource.
 */
export function startGsiSource({
  scripts = ['cyrillic'],
  port = GSI_PORT,
  quietMs = 15000,
  onMessage = () => {},
  onStatus = () => {},
  onUnknownTag = () => {},
  createServer = http.createServer,
  identify = null,
  onSteamId = () => {},
} = {}) {
  const chat = createGsiChat({ scripts, onMessage, identify, onSteamId, onUnknownChannel: (n) => onUnknownTag('channel_type ' + n) });
  let hearing = false;
  let quiet = null;

  const server = createServer((req, res) => {
    let body = '';
    let over = false;
    req.setEncoding('utf8');
    req.on('data', (c) => {
      if (over) return;
      body += c;
      if (body.length > 4 * 1024 * 1024) { over = true; body = ''; }
    });
    req.on('end', () => {
      res.writeHead(200); res.end('ok');
      if (over || req.method !== 'POST') return;
      if (!chat.payload(body)) return;
      if (!hearing) { hearing = true; onStatus({ kind: 'ready', text: 'Reading chat.' }); }
      clearTimeout(quiet);
      quiet = setTimeout(() => { hearing = false; onStatus({ kind: 'waiting', text: 'Waiting for Dota 2.' }); }, quietMs);
      quiet.unref?.();
    });
  });
  server.on('error', (err) => {
    onStatus({ kind: 'error', text: err && err.code === 'EADDRINUSE'
      ? `Another program is using port ${port}, so Dota's chat feed cannot be heard. Is Dota Translator running twice?`
      : 'Could not listen for Dota: ' + ((err && err.message) || err) });
  });
  // This machine only: the feed is for nobody else.
  server.listen(port, '127.0.0.1');
  onStatus({ kind: 'waiting', text: 'Waiting for Dota 2.' });

  return {
    stop() { clearTimeout(quiet); try { server.close(); } catch { /* not open */ } },
    get running() { return server.listening; },
  };
}
