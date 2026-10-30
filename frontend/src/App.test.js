import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import App from './App';
import {
  betterThanPercent, yearTicks, formatMonth, formatYears, growthPoints, histogram, ratingAt, latestChange, nearbyPlayers, personalBest, rivalGroup, yearChange, loadPlayerHistory, matchesFilters,
  niceTicks, playerStanding, searchPlayers, toAppPlayer,
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

  test('year ticks stay readable over long histories', () => {
    expect(yearTicks(Date.UTC(2011, 0, 1), Date.UTC(2026, 9, 1), 7).map(t => new Date(t).getUTCFullYear())).toEqual([2015, 2020, 2025]);
    expect(yearTicks(Date.UTC(2023, 5, 1), Date.UTC(2026, 9, 1), 7).map(t => new Date(t).getUTCFullYear())).toEqual([2024, 2025, 2026]);
  });

  test('chart helpers produce round ticks and change summaries', () => {
    expect(niceTicks(3173, 3546)).toEqual({ domain: [3100, 3600], ticks: [3100, 3200, 3300, 3400, 3500, 3600] });
    const h = [{ date: '2024-06-01', t: Date.UTC(2024, 5, 1), rating: 1400 }, { date: '2025-09-01', t: Date.UTC(2025, 8, 1), rating: 1450 }, { date: '2026-09-01', t: Date.UTC(2026, 8, 1), rating: 1500 }];
    expect(yearChange(h, 1520, NOW)).toEqual({ delta: 70, since: '2025-09-01', sinceStart: false });
    expect(yearChange(h.slice(2), 1520, NOW)).toBeNull();
    expect(yearChange([{ ...h[2] }, { date: '2026-10-01', t: Date.UTC(2026, 9, 1), rating: 1510 }], 1510, NOW)).toEqual({ delta: 10, since: '2026-09-01', sinceStart: true });
    expect(personalBest([{ rating: 5 }, { rating: 9 }, { rating: 7 }])).toEqual({ rating: 9 });
    expect(betterThanPercent(2, 4)).toBe(50);
    expect(latestChange([{ date: '2026-08-04', rating: 4063 }, { date: '2026-09-07', rating: 4071 }])).toEqual({ delta: 8, since: '2026-08-04' });
    expect(histogram(players, 1000).map(b => b.count)).toEqual([0, 3, 0, 0, 1]);
  });

  test('lines histories up by age or career and reads ratings in between', () => {
    const h = [{ date: '2024-01-01', rating: 800 }, { date: '2025-01-01', rating: 1000 }, { date: '2028-01-01', rating: 1500 }];
    const byAge = growthPoints(h, 'age', 2011);
    expect(byAge.map(p => Math.round(p.x * 100) / 100)).toEqual([13, 14, 17]);
    expect(ratingAt(byAge, 13.5)).toBe(900);
    expect(ratingAt(byAge, 15)).toBeNull(); // across a three-year break
    expect(growthPoints(h, 'career', null)[1].x).toBeCloseTo(1, 1);
    expect(formatYears(16.75)).toBe('16¾');
    expect(formatYears(16.99)).toBe('17');
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
    fireEvent.click(within(card).getByRole('button', { name: 'LI Wei' }));
    expect(window.location.search).toBe('?player=100');
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

  test('shows players who grew like you and how they kept going', async () => {
    const doc = {
      ...playersDoc,
      players: [
        { id: '500', name: 'NEW Kid', province: 'ON', gender: 'F', rating: 1200, lastPlayed: '2026-01-01', birthYear: 2014 },
        { id: '564', name: 'OLDER Star', province: 'ON', gender: 'F', rating: 1650, lastPlayed: '2015-01-01', birthYear: 1996 },
        { id: '628', name: 'TEEN Player', province: 'ON', gender: 'F', rating: 1300, lastPlayed: '2026-01-01', birthYear: 2010, growth: 150, growthSince: '2025-01-01' },
      ],
    };
    window.history.replaceState(null, '', '/?player=500');
    mockFetch({
      '/data/players.json': { body: doc },
      '/data/history/52.json': { body: {
        500: [[1, '2024-01-01', 800], [2, '2025-01-01', 1000], [3, '2026-01-01', 1200]],
        564: [[1, '2006-01-01', 790], [2, '2007-01-01', 1010], [3, '2008-01-01', 1190], [4, '2009-01-01', 1400], [5, '2010-01-01', 1550], [6, '2011-01-01', 1600]],
        628: [[1, '2025-01-01', 1150], [2, '2026-01-01', 1300]],
      } },
      '/data/similar/52.json': { body: { 500: [{ id: '564', by: 'age', at: 12, rating: 1190, match: 'path' }], 628: [{ id: '564', by: 'age', at: 16, rating: 1600, match: 'path' }] } },
    });
    render(<App />);
    const tab = await screen.findByRole('tab', { name: /OLDER Star/ });
    expect(tab).toHaveTextContent('Similar climb');
    expect(tab).toHaveTextContent('At age 12: 1,190');
    expect(tab).toHaveTextContent('+1y 1,400 (+210)');
    expect(tab).toHaveTextContent('+3y 1,600 (+410)');
    expect(screen.getByText('NEW Kid', { selector: '.legend li' })).toBeInTheDocument();
    // older players don't get the section
    fireEvent.click(within(screen.getByRole('table', { name: /Top players/ })).getByRole('button', { name: 'TEEN Player' }));
    expect(await screen.findByRole('region', { name: 'TEEN Player' })).toBeInTheDocument();
    expect(screen.queryByText('Players who grew like you')).not.toBeInTheDocument();
    // ...they see their own rating journey instead
    expect(await screen.findByText('Rating journey')).toBeInTheDocument();
    expect(screen.getByText('From 1,150 in Jan 2025 to 1,300 in Jan 2026')).toBeInTheDocument();
    // the climbers table ranks by 12-month gain and the tile shows the same number
    const climbers = screen.getByRole('table', { name: /Fastest climbers/ });
    expect(within(climbers).getAllByRole('row')[1]).toHaveTextContent('TEEN Player');
    expect(within(climbers).getAllByRole('row')[1]).toHaveTextContent('+150');
    expect(within(screen.getByRole('region', { name: 'TEEN Player' })).getByText('+150')).toBeInTheDocument();
  });

  test('the rating calculator adds up a tournament and handles new players', async () => {
    window.history.replaceState(null, '', '/?page=calculator');
    mockFetch({ '/data/players.json': { body: playersDoc } });
    render(<App />);
    await screen.findByRole('heading', { name: /Rating calculator/ });

    fireEvent.change(screen.getByPlaceholderText('e.g. 1500'), { target: { value: '1500' } });
    expect(screen.getByRole('radio', { name: '★★' })).toHaveAttribute('aria-checked', 'true'); // the default
    fireEvent.change(screen.getByLabelText('Match 1 opponent rating'), { target: { value: '1380' } });
    fireEvent.change(screen.getByLabelText('Match 2 opponent rating'), { target: { value: '1650' } });
    expect(screen.getAllByRole('listitem').filter(li => li.className === 'calc-match')).toHaveLength(2); // two rows to start
    fireEvent.click(screen.getByRole('button', { name: '+ Add a match' }));
    fireEvent.change(screen.getByLabelText('Match 3 opponent rating'), { target: { value: '1450' } });
    fireEvent.click(screen.getAllByRole('radio', { name: 'I lost' })[2]);

    const matches = screen.getAllByRole('listitem').filter(li => li.className === 'calc-match');
    expect(matches.map(m => within(m).getByText(/^[+−±]\d/).textContent)).toEqual(['+8', '+24', '−16']);
    expect(within(matches[1]).getByText('Upset win · you were 150 points lower')).toBeInTheDocument();
    const result = screen.getByRole('region', { name: /Result/ });
    expect(within(result).getByText('+16')).toBeInTheDocument();
    expect(within(result).getByText('1,516')).toBeInTheDocument();

    // an unrated opponent exchanges nothing
    fireEvent.change(screen.getByLabelText('Match 3 opponent status'), { target: { value: 'unrated' } });
    expect(within(result).getByText('+32')).toBeInTheDocument();

    // a new player: Wing's example from the rules gives 1155
    fireEvent.click(screen.getByRole('radio', { name: 'I’m new' }));
    fireEvent.change(screen.getByLabelText('Match 3 opponent status'), { target: { value: 'rated' } });
    fireEvent.click(screen.getByRole('button', { name: '+ Add a match' }));
    ['1145', '1070', '1210', '1100'].forEach((r, i) => fireEvent.change(screen.getByLabelText(`Match ${i + 1} opponent rating`), { target: { value: r } }));
    fireEvent.click(screen.getAllByRole('radio', { name: 'I won' })[2]);
    fireEvent.click(screen.getAllByRole('radio', { name: 'I lost' })[3]);
    expect(within(result).getByText('1,155')).toBeInTheDocument();
    expect(within(result).getByText(/rule 3\.2/)).toBeInTheDocument();
  });

  test('picking yourself from the ratings page carries into the calculator', async () => {
    window.history.replaceState(null, '', '/?player=7864');
    mockFetch({ '/data/players.json': { body: playersDoc }, '/data/history/56.json': { body: {} } });
    render(<App />);
    await screen.findByRole('region', { name: 'WANG Eugene Zhen' });
    fireEvent.click(screen.getByRole('link', { name: /Rating calculator/ }));
    expect(await screen.findByPlaceholderText('e.g. 1500')).toHaveValue('4071');
    expect(Object.fromEntries(new URLSearchParams(window.location.search))).toEqual({ page: 'calculator', player: '7864' });
  });

  test('both tables start with 10 rows, fastest climbers first', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
      id: String(1000 + i), name: `PLAYER ${i}`, province: 'ON', gender: 'M', rating: 2000 - i,
      lastPlayed: '2026-09-01', birthYear: 2012, growth: 100 + i, growthSince: '2025-10-01',
    }));
    window.history.replaceState(null, '', '/');
    mockFetch({ '/data/players.json': { body: { ...playersDoc, players: many } } });
    render(<App />);
    const climbers = await screen.findByRole('table', { name: /Fastest climbers/ });
    const top = screen.getByRole('table', { name: /Top players/ });
    expect(within(climbers).getAllByRole('row')).toHaveLength(11); // header + 10
    expect(within(top).getAllByRole('row')).toHaveLength(11);
    expect(climbers.compareDocumentPosition(top) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Show more climbers' }));
    expect(within(climbers).getAllByRole('row')).toHaveLength(21);
  });
});
