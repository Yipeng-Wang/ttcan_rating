import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import App from './App';
import {
  betterThanPercent, formatMonth, histogram, latestChange, nearbyPlayers, personalBest, rivalGroup, yearChange, loadPlayerHistory, matchesFilters, mergeHistories,
  niceTicks, playerStanding, searchPlayers, toAppPlayer, yearTicks,
} from './data';

const playersDoc = {
  generatedAt: '2026-10-29T12:00:00+00:00',
  period: '427',
  historyShards: 64,
  players: [
    { id: '7864', name: 'WANG Eugene Zhen', province: 'ON', gender: 'M', rating: 4071, lastPlayed: '2026-09-07', birthYear: 1985 },
    { id: '100', name: 'LI Wei', province: 'ON', gender: 'M', rating: 1500, lastPlayed: '2026-08-01', birthYear: null },
    { id: '200', name: 'LI Wei', province: 'BC', gender: 'F', rating: 1200, lastPlayed: '2024-01-15', birthYear: 2012 },
    { id: '300', name: 'GAGNON François', province: 'QC', gender: 'M', rating: 1500, lastPlayed: '2025-01-01', birthYear: 2011 },
  ],
};
const players = playersDoc.players.map(p => toAppPlayer(p, 2026));
const NOW = new Date(2026, 9, 29);

function mockFetch(routes) {
  global.fetch = jest.fn(url => {
    const key = Object.keys(routes).find(k => url.endsWith(k));
    const value = key ? routes[key] : { status: 404 };
    const status = value.status || 200;
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(value.body) });
  });
}

beforeAll(() => {
  window.scrollTo = jest.fn();
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});
beforeEach(() => window.history.replaceState(null, '', '/'));

describe('data helpers', () => {
  test('formats months and ages', () => {
    expect(formatMonth('2026-09-07')).toBe('Sep 2026');
    expect(players[0]).toMatchObject({ id: '7864', age: 41, lastPlayed: '2026-09-07' });
    expect(players[1].age).toBeNull();
  });

  test('search matches word starts first, ignores accents, keeps same-name players apart', () => {
    expect(searchPlayers(players, 'li wei').map(p => p.id)).toEqual(['100', '200']);
    expect(searchPlayers(players, 'francois')[0].id).toBe('300');
    expect(searchPlayers(players, 'zzz')).toEqual([]);
  });

  test('filters by activity window and age group', () => {
    expect(matchesFilters(players[2], { active: '24' }, NOW)).toBe(false);
    expect(matchesFilters(players[2], { active: '36' }, NOW)).toBe(true);
    expect(matchesFilters(players[2], { age: 'u15' }, NOW)).toBe(true);
    expect(matchesFilters(players[1], { age: 'u15' }, NOW)).toBe(false);
  });

  test('players near you come from the age group, or the province for adults', () => {
    const kids = [
      ...players,
      toAppPlayer({ id: '401', name: 'A', province: 'ON', gender: 'M', rating: 1600, lastPlayed: '2026-05-01', birthYear: 2012 }, 2026),
      toAppPlayer({ id: '402', name: 'B', province: 'ON', gender: 'M', rating: 1400, lastPlayed: '2026-05-01', birthYear: 2013 }, 2026),
      toAppPlayer({ id: '403', name: 'C', province: 'ON', gender: 'F', rating: 1450, lastPlayed: '2026-05-01', birthYear: 2013 }, 2026),
    ];
    const group = rivalGroup(kids, kids[3], '', NOW);
    expect(group.label).toBe('U15 boys');
    expect(nearbyPlayers(group.players, kids[3]).map(r => [r.player.id, r.rank, r.isSelf])).toEqual([['401', 1, false], ['300', 2, true], ['402', 3, false]]);
    // the window shifts so a top-ranked player still sees a full list
    const many = Array.from({ length: 8 }, (_, i) => ({ id: String(i), name: `P${i}`, rating: 1000 - i * 10 }));
    expect(nearbyPlayers(many, many[0]).map(r => r.player.id)).toEqual(['0', '1', '2', '3', '4']);
    expect(nearbyPlayers(many, many[7]).map(r => r.player.id)).toEqual(['3', '4', '5', '6', '7']);
    expect(nearbyPlayers(many, many[4]).map(r => r.player.id)).toEqual(['2', '3', '4', '5', '6']);
    expect(rivalGroup(kids, kids[0], '', NOW).label).toBe('Ontario');
  });

  test('ranks with ties and per-scope totals', () => {
    const s = playerStanding(players, players[3], '', NOW);
    expect(s.scopes.find(x => x.id === 'canada')).toMatchObject({ rank: 2, total: 4 });
    expect(s.scopes.find(x => x.id === 'province')).toMatchObject({ rank: 1, total: 1 });
    expect(s.scopes.find(x => x.id === 'age')).toMatchObject({ label: 'U15 boys', rank: 1, total: 1 });
    expect(playerStanding(players, players[2], '12', NOW).inPool).toBe(false);
  });

  test('chart helpers produce round ticks, year ticks and merged series', () => {
    expect(niceTicks(3173, 3546)).toEqual({ domain: [3100, 3600], ticks: [3100, 3200, 3300, 3400, 3500, 3600] });
    expect(yearTicks(Date.UTC(2011, 0, 1), Date.UTC(2026, 9, 1), 7).map(t => new Date(t).getUTCFullYear())).toEqual([2015, 2020, 2025]);
    const a = [{ t: 1, rating: 10 }, { t: 3, rating: 30 }];
    const b = [{ t: 2, rating: 20 }];
    expect(mergeHistories(a, b)).toEqual([
      { t: 1, a: 10, b: null, aNow: 10, bNow: null },
      { t: 2, a: null, b: 20, aNow: 10, bNow: 20 },
      { t: 3, a: 30, b: null, aNow: 30, bNow: 20 },
    ]);
    const h = [{ date: '2024-06-01', t: Date.UTC(2024, 5, 1), rating: 1400 }, { date: '2025-09-01', t: Date.UTC(2025, 8, 1), rating: 1450 }, { date: '2026-09-01', t: Date.UTC(2026, 8, 1), rating: 1500 }];
    expect(yearChange(h, 1520, NOW)).toEqual({ delta: 70, since: '2025-09-01', sinceStart: false });
    expect(yearChange(h.slice(2), 1520, NOW)).toBeNull();
    expect(yearChange([{ ...h[2] }, { date: '2026-10-01', t: Date.UTC(2026, 9, 1), rating: 1510 }], 1510, NOW)).toEqual({ delta: 10, since: '2026-09-01', sinceStart: true });
    expect(personalBest([{ rating: 5 }, { rating: 9 }, { rating: 7 }])).toEqual({ rating: 9 });
    expect(betterThanPercent(2, 4)).toBe(50);
    expect(latestChange([{ date: '2026-08-04', rating: 4063 }, { date: '2026-09-07', rating: 4071 }])).toEqual({ delta: 8, since: '2026-08-04' });
    expect(histogram(players, 1000).map(b => b.count)).toEqual([0, 3, 0, 0, 1]);
  });

  test('loads one history shard for players that share it', async () => {
    mockFetch({ '/data/history/36.json': { body: { 100: [[420, '2026-02-28', 1490]], 164: [[421, '2026-03-31', 900]] } } });
    expect(await loadPlayerHistory('100')).toEqual([{ date: '2026-02-28', t: Date.UTC(2026, 1, 28), rating: 1490 }]);
    expect(await loadPlayerHistory('164')).toHaveLength(1);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('app', () => {
  test('shows the leaderboard and tells same-name players apart in search', async () => {
    mockFetch({ '/data/players.json': { body: playersDoc } });
    render(<App />);
    expect(await screen.findByText(/Rating period 427/)).toBeInTheDocument();
    const board = screen.getByRole('table', { name: 'Top players' });
    expect(within(board).getByText('WANG Eugene Zhen')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Find a player' }), { target: { value: 'li wei' } });
    const options = within(await screen.findByRole('listbox')).getAllByRole('option');
    expect(options.map(o => o.textContent)).toEqual(['LI WeiON1,500', 'LI WeiBC · age 141,200']);
  });

  test('selecting a player shows their card and puts them in the address', async () => {
    mockFetch({
      '/data/players.json': { body: playersDoc },
      '/data/history/56.json': { body: { 7864: [[425, '2026-08-04', 4063], [426, '2026-09-07', 4071]] } },
    });
    render(<App />);
    await screen.findByText(/Rating period 427/);
    fireEvent.change(screen.getByRole('combobox', { name: 'Find a player' }), { target: { value: 'wang' } });
    fireEvent.mouseDown(within(await screen.findByRole('listbox')).getByRole('option'));

    const card = await screen.findByRole('region', { name: 'WANG Eugene Zhen' });
    expect(within(card).getAllByText('4,071')).toHaveLength(2); // rating tile and players-near-you row
    expect(within(card).getByText(/Ranked just above and below in Ontario/)).toBeInTheDocument();
    expect(await within(card).findByText(/Up 8 since Aug 2026/)).toBeInTheDocument();
    expect(within(card).getByText('75%')).toBeInTheDocument();
    expect(within(card).getByText('First rated Aug 2026 · 2 rating periods on record')).toBeInTheDocument();
    expect(within(card).getByText('That’s right now!')).toBeInTheDocument();
    expect(window.location.search).toBe('?player=7864');
    fireEvent.click(within(card).getByRole('button', { name: 'Compare' }));
    expect(window.location.search).toBe('?player=7864&compare=100');
    // selecting a player no longer changes the filters
    expect(screen.getByLabelText('Province')).toHaveValue('');
  });

  test('a shared link opens the player and filters', async () => {
    window.history.replaceState(null, '', '/?player=300&province=QC');
    mockFetch({ '/data/players.json': { body: playersDoc }, '/data/history/44.json': { body: {} } });
    render(<App />);
    expect(await screen.findByRole('region', { name: 'GAGNON François' })).toBeInTheDocument();
    expect(screen.getByLabelText('Province')).toHaveValue('QC');
    expect(screen.getByText(/Players in Quebec · 1 player/, { selector: '#board-title + p' })).toBeInTheDocument();
  });

  test('a history failure stays inside the player card', async () => {
    window.history.replaceState(null, '', '/?player=200');
    mockFetch({ '/data/players.json': { body: playersDoc }, '/data/history/8.json': { status: 500 } });
    render(<App />);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t load rating history'));
    expect(screen.getByRole('table', { name: 'Top players' })).toBeInTheDocument();
  });
});
