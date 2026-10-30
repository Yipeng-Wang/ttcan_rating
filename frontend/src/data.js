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


// ---- loading -------------------------------------------------------------

let historyShardCount = 64;
const shardCache = new Map(); // "kind/shard" -> Promise<{ [playerId]: ... }>

/** Fetch (once) the shard file of a sharded folder such as history/ or similar/. */
function loadShard(kind, playerId) {
  const shard = Number(playerId) % historyShardCount;
  const key = `${kind}/${shard}`;
  if (!shardCache.has(key)) {
    const request = fetch(`${DATA_URL}/${key}.json`).then(response => {
      if (response.status === 404) return {}; // no player in this shard has data
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    });
    shardCache.set(key, request);
    request.catch(() => shardCache.delete(key)); // allow a retry
  }
  return shardCache.get(key);
}

export function toAppPlayer(raw, currentYear = new Date().getFullYear()) {
  return {
    id: String(raw.id),
    name: raw.name || '',
    province: raw.province || '',
    gender: raw.gender || '',
    rating: Number(raw.rating),
    lastPlayed: raw.lastPlayed || '',
    age: raw.birthYear ? currentYear - raw.birthYear : null,
    birthYear: raw.birthYear || null,
    provisional: Boolean(raw.temporary),
    growth: raw.growth ?? null,           // rating change over the last 12 months, when comparable
    growthSince: raw.growthSince || null,
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
  const entries = (await loadShard('history', playerId))[playerId] || [];
  return entries.map(([, date, rating]) => ({ date, t: isoToTime(date), rating }));
}

/** Players whose rating grew like this player's: [{ id, by: 'age'|'career', at, match: 'path'|'level' }]. */
export async function loadSimilar(playerId) {
  if (!playerId) return [];
  return (await loadShard('similar', playerId))[playerId] || [];
}

// ---- growth (age-aligned) ----------------------------------------------

function decimalYear(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return y + (m - 1) / 12 + (d - 1) / 365;
}

/** History as [{ x, rating }] where x is age, or years since the first rating. */
export function growthPoints(history, by, birthYear) {
  if (!history.length) return [];
  const origin = by === 'age' ? birthYear : decimalYear(history[0].date);
  if (origin == null) return [];
  return history.map(e => ({ x: decimalYear(e.date) - origin, rating: e.rating }));
}

/** Rating at x by straight-line interpolation; null outside the history or across long breaks. */
export function ratingAt(points, x, maxGap = 1.5) {
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (Math.abs(p.x - x) < 1e-6) return p.rating;
    const next = points[i + 1];
    if (next && p.x < x && x < next.x) {
      if (next.x - p.x > maxGap) return null;
      return Math.round(p.rating + ((next.rating - p.rating) * (x - p.x)) / (next.x - p.x));
    }
  }
  return null;
}

/** "16.75" -> "16¾", for ages and career years. */
export function formatYears(x) {
  const quarters = Math.round(x * 4);
  return `${Math.floor(quarters / 4)}${['', '¼', '½', '¾'][quarters % 4]}`;
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

/**
 * Rating change over the past year: current rating versus the last rating on record
 * a year ago. Falls back to the first rating when the player started less than a year ago.
 */
export function yearChange(history, currentRating, now = new Date()) {
  if (!history.length) return null;
  const yearAgo = Date.UTC(now.getFullYear() - 1, now.getMonth(), now.getDate());
  let base = null;
  for (const e of history) if (e.t <= yearAgo) base = e;
  if (base) return { delta: currentRating - base.rating, since: base.date, sinceStart: false };
  if (history.length < 2) return null;
  return { delta: currentRating - history[0].rating, since: history[0].date, sinceStart: true };
}

/**
 * A window of `size` players around `player` in a pool sorted by rating, with their ranks.
 * Centred on the player, shifted at the top or bottom so the window stays full.
 */
export function nearbyPlayers(pool, player, size = 5) {
  const sorted = sortByRating(pool);
  const index = sorted.findIndex(p => p.id === player.id);
  if (index < 0) return [];
  const ranks = [];
  sorted.forEach((p, i) => ranks.push(i > 0 && p.rating === sorted[i - 1].rating ? ranks[i - 1] : i + 1));
  const from = Math.max(0, Math.min(index - Math.floor(size / 2), sorted.length - size));
  const to = Math.min(sorted.length, from + size);
  return sorted.slice(from, to).map((p, i) => ({ player: p, rank: ranks[from + i], isSelf: p.id === player.id }));
}

/**
 * The group a player is most usefully compared with: their age group (same gender) if young,
 * otherwise their province. Uses the same activity window as the rankings so ranks agree.
 */
export function rivalGroup(players, player, active, now = new Date()) {
  const pool = players.filter(p => p.id === player.id || matchesFilters(p, { active }, now));
  const group = ageGroupOf(player.age);
  if (group) {
    const genderWord = player.gender === 'F' ? ' girls' : player.gender === 'M' ? ' boys' : '';
    return {
      label: `${group.label}${genderWord}`,
      players: pool.filter(p => p.age != null && p.age <= group.max && (!player.gender || p.gender === player.gender)),
    };
  }
  return {
    label: PROVINCES[player.province] || player.province || 'Canada',
    players: player.province ? pool.filter(p => p.province === player.province) : pool,
  };
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

/** January-1st ticks (UTC timestamps) spaced so there are at most `target` of them. */
export function yearTicks(minTime, maxTime, target = 6) {
  const first = new Date(minTime).getUTCFullYear() + 1;
  const last = new Date(maxTime).getUTCFullYear();
  const span = Math.max(1, last - first + 1);
  const every = [1, 2, 5, 10].find(n => span / n <= target) || 10;
  const ticks = [];
  for (let y = first; y <= last; y++) if (y % every === 0) ticks.push(Date.UTC(y, 0, 1));
  return ticks;
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


