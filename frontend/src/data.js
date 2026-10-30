// Data loading and pure helpers. Everything here is UI-free so it can be unit tested.

export const DATA_URL = `${process.env.PUBLIC_URL || ''}/data`;

export const PROVINCES = {
  AB: 'Alberta', BC: 'British Columbia', MB: 'Manitoba', NB: 'New Brunswick',
  NL: 'Newfoundland and Labrador', NS: 'Nova Scotia', NT: 'Northwest Territories',
  NU: 'Nunavut', ON: 'Ontario', PE: 'Prince Edward Island', QC: 'Quebec',
  SK: 'Saskatchewan', YK: 'Yukon', YT: 'Yukon', FO: 'Outside Canada',
};

export const GENDERS = { F: 'Female', M: 'Male' };
// Friendlier group names used in rankings and filters
export const GENDER_GROUPS = { F: 'Girls & women', M: 'Boys & men' };

// Age groups follow the existing "age at or under N" rule.
export const AGE_GROUPS = [9, 10, 11, 12, 13, 14, 15, 17, 19].map(n => ({ id: `u${n}`, max: n, label: `U${n}` }));

export const ACTIVITY_OPTIONS = [
  { id: '', label: 'All time' },
  { id: '12', label: '1 year' },
  { id: '24', label: '2 years' },
  { id: '36', label: '3 years' },
];

export const RANGE_OPTIONS = [
  { id: '', label: 'All' },
  { id: '10y', label: '10 yrs', years: 10 },
  { id: '5y', label: '5 yrs', years: 5 },
  { id: '2y', label: '2 yrs', years: 2 },
];

// ---- loading -------------------------------------------------------------

let historyShardCount = 64;
const historyShardCache = new Map(); // shard -> Promise<{ [playerId]: [[periodId, isoDate, rating], ...] }>

export function toAppPlayer(raw, currentYear = new Date().getFullYear()) {
  return {
    id: String(raw.id),
    name: raw.name || '',
    province: raw.province || '',
    gender: raw.gender || '',
    rating: Number(raw.rating),
    lastPlayed: raw.lastPlayed || '',
    age: raw.birthYear ? currentYear - raw.birthYear : null,
  };
}

export async function loadPlayers(fetchImpl = fetch) {
  const response = await fetchImpl(`${DATA_URL}/players.json`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const json = await response.json();
  if (!json || !Array.isArray(json.players)) throw new Error('Unexpected data format');
  if (json.historyShards) historyShardCount = json.historyShards;
  const players = json.players
    .filter(p => p && p.id && p.name && Number.isFinite(Number(p.rating)))
    .map(p => toAppPlayer(p));
  return { players, period: json.period, generatedAt: json.generatedAt };
}

export async function loadPlayerHistory(playerId) {
  if (!playerId) return [];
  const shard = Number(playerId) % historyShardCount;
  if (!historyShardCache.has(shard)) {
    const request = fetch(`${DATA_URL}/history/${shard}.json`).then(response => {
      if (response.status === 404) return {};
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
    historyShardCache.set(shard, request);
    request.catch(() => historyShardCache.delete(shard)); // allow a retry
  }
  const entries = (await historyShardCache.get(shard))[playerId] || [];
  return entries.map(([, date, rating]) => ({ date, t: isoToTime(date), rating }));
}

// ---- dates & formatting ---------------------------------------------------

export function isoToTime(iso) {
  const [y, m, d] = (iso || '').split('-').map(Number);
  return y ? Date.UTC(y, (m || 1) - 1, d || 1) : NaN;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** '2026-09-07' or a UTC timestamp -> 'Sep 2026' */
export function formatMonth(value) {
  const time = typeof value === 'number' ? value : isoToTime(value);
  if (!Number.isFinite(time)) return '—';
  const date = new Date(time);
  return `${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export function formatNumber(n) {
  return Number(n).toLocaleString('en-CA');
}

export function monthsAgoIso(months, now = new Date()) {
  const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() - months, now.getDate()));
  return d.toISOString().slice(0, 10);
}

// ---- filtering & ranking -------------------------------------------------

export function ageGroupOf(age) {
  if (age == null) return null;
  return AGE_GROUPS.find(g => age <= g.max) || null;
}

export function matchesFilters(player, filters, now = new Date()) {
  if (filters.province && player.province !== filters.province) return false;
  if (filters.gender && player.gender !== filters.gender) return false;
  if (filters.age) {
    const group = AGE_GROUPS.find(g => g.id === filters.age);
    if (!group || player.age == null || player.age > group.max) return false;
  }
  if (filters.active && player.lastPlayed < monthsAgoIso(Number(filters.active), now)) return false;
  return true;
}

export function sortByRating(players) {
  return [...players].sort((a, b) => b.rating - a.rating || a.name.localeCompare(b.name));
}

/** Competition ranking: ties share a rank ("1, 2, 2, 4"). */
export function rankAmong(players, player) {
  let higher = 0;
  for (const p of players) if (p.rating > player.rating) higher++;
  return { rank: higher + 1, total: players.length };
}

/** Where a player stands overall, in their province, gender and age group, among players passing `active`. */
export function playerStanding(players, player, active, now = new Date()) {
  const pool = players.filter(p => matchesFilters(p, { active }, now));
  const scopes = [{ id: 'canada', label: 'Canada', players: pool }];
  if (player.province) {
    scopes.push({ id: 'province', label: PROVINCES[player.province] || player.province, players: pool.filter(p => p.province === player.province) });
  }
  if (player.gender) {
    scopes.push({ id: 'gender', label: GENDER_GROUPS[player.gender].toLowerCase(), players: pool.filter(p => p.gender === player.gender) });
  }
  const group = ageGroupOf(player.age);
  if (group) {
    const sameGroup = pool.filter(p => p.age != null && p.age <= group.max && (!player.gender || p.gender === player.gender));
    scopes.push({ id: 'age', label: `${group.label}${player.gender ? ` ${player.gender === 'F' ? 'girls' : 'boys'}` : ''}`, players: sameGroup });
  }
  const inPool = pool.some(p => p.id === player.id);
  return {
    inPool,
    scopes: scopes.map(({ id, label, players: scoped }) => ({ id, label, ...rankAmong(scoped, player) })),
  };
}

/** Share of players rated below, as a whole percent ("better than 95%"). */
export function betterThanPercent(rank, total) {
  if (!total || total < 2) return null;
  return Math.floor(((total - rank) / total) * 100);
}

/** The next round-hundred goal above a rating, and how far along the current hundred the player is. */
export function nextMilestone(rating, step = 100) {
  const goal = (Math.floor(rating / step) + 1) * step;
  return { goal, toGo: goal - rating, progress: (rating % step) / step };
}

/** Highest rating in a history. */
export function personalBest(history) {
  if (!history.length) return null;
  return history.reduce((best, e) => (e.rating > best.rating ? e : best), history[0]);
}

/** Change between the last two rating periods in a history. */
export function latestChange(history) {
  if (history.length < 2) return null;
  const last = history[history.length - 1];
  const previous = history[history.length - 2];
  return { delta: last.rating - previous.rating, since: previous.date };
}

// ---- search --------------------------------------------------------------

function normalise(text) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Players whose name contains every typed word; word-start matches first, then by rating. */
export function searchPlayers(players, query, limit = 8) {
  const words = normalise(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  const scored = [];
  for (const player of players) {
    const name = normalise(player.name);
    if (!words.every(w => name.includes(w))) continue;
    const tokens = name.split(/[\s-]+/);
    const startsWord = words.every(w => tokens.some(t => t.startsWith(w)));
    scored.push({ player, score: startsWord ? 0 : 1 });
  }
  scored.sort((a, b) => a.score - b.score || b.player.rating - a.player.rating);
  return scored.slice(0, limit).map(s => s.player);
}

// ---- charts --------------------------------------------------------------

export function histogram(players, binSize = 100) {
  if (!players.length) return [];
  const max = Math.max(...players.map(p => p.rating));
  const bins = [];
  for (let start = 0; start <= max; start += binSize) bins.push({ start, end: start + binSize - 1, count: 0 });
  for (const p of players) bins[Math.floor(p.rating / binSize)].count++;
  return bins;
}

/** Round axis ticks: 3173..3546 -> [3200, 3300, 3400, 3500] with a domain that contains them. */
export function niceTicks(min, max, target = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { domain: [0, 1], ticks: [0, 1] };
  if (min === max) { min -= 50; max += 50; }
  const raw = (max - min) / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(m => m * magnitude).find(s => s >= raw);
  const lo = Math.floor(min / step) * step;
  const hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 2; v += step) ticks.push(Math.round(v));
  return { domain: [lo, hi], ticks };
}

/** January-1st ticks spaced so there are at most `target` of them. */
export function yearTicks(minTime, maxTime, target = 6) {
  const first = new Date(minTime).getUTCFullYear() + 1;
  const last = new Date(maxTime).getUTCFullYear();
  const span = Math.max(1, last - first + 1);
  const every = [1, 2, 5, 10].find(n => span / n <= target) || 10;
  const ticks = [];
  for (let y = first; y <= last; y++) if (y % every === 0) ticks.push(Date.UTC(y, 0, 1));
  return ticks;
}

/**
 * Merge two histories onto one time axis. Each row keeps the actual value where the
 * player had a rating that period (for the line) and the latest known value (for the tooltip).
 */
export function mergeHistories(a, b, fromTime = -Infinity) {
  const times = [...new Set([...a, ...(b || [])].map(e => e.t))].filter(t => t >= fromTime).sort((x, y) => x - y);
  const byTime = list => new Map((list || []).map(e => [e.t, e.rating]));
  const ma = byTime(a), mb = byTime(b);
  let lastA = null, lastB = null;
  for (const e of a) if (e.t < fromTime) lastA = e.rating;
  for (const e of b || []) if (e.t < fromTime) lastB = e.rating;
  return times.map(t => {
    if (ma.has(t)) lastA = ma.get(t);
    if (mb.has(t)) lastB = mb.get(t);
    return { t, a: ma.has(t) ? ma.get(t) : null, b: mb.has(t) ? mb.get(t) : null, aNow: lastA, bNow: lastB };
  });
}
