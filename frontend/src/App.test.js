import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import App, { isoToUsDate, toAppPlayer, loadPlayerHistory } from './App';

const playersDoc = {
  generatedAt: '2026-10-29T12:00:00+00:00',
  period: '427',
  historyShards: 64,
  players: [
    { id: '7864', name: 'WANG Eugene Zhen', province: 'ON', gender: 'M', rating: 4071, lastPlayed: '2026-09-07', birthYear: 1985 },
    { id: '100', name: 'LI Wei', province: 'ON', gender: 'M', rating: 1500, lastPlayed: '2026-08-01', birthYear: null },
    { id: '200', name: 'LI Wei', province: 'BC', gender: 'F', rating: 1200, lastPlayed: '2026-08-01', birthYear: 2012 },
  ],
};

function mockFetch(routes) {
  global.fetch = jest.fn(url => {
    const key = Object.keys(routes).find(k => url.endsWith(k));
    const value = key ? routes[key] : { status: 404 };
    if (value instanceof Error) return Promise.reject(value);
    const status = value.status || 200;
    return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(value.body) });
  });
}

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = jest.fn();
  global.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
});

test('converts ISO dates and birth years for the UI', () => {
  expect(isoToUsDate('2026-09-07')).toBe('9/7/2026');
  expect(isoToUsDate('')).toBe('');
  expect(toAppPlayer(playersDoc.players[0], 2026)).toMatchObject({ id: '7864', age: '41', lastPlayed: '9/7/2026' });
  expect(toAppPlayer(playersDoc.players[1], 2026).age).toBe('');
});

test('loads one history shard for players that share it', async () => {
  mockFetch({ '/data/history/36.json': { body: { '100': [[420, '2026-02-28', 1490]], '164': [[421, '2026-03-31', 900]] } } });
  expect(await loadPlayerHistory('100')).toEqual([{ period: '2026-02-28', rating: 1490, lastPlayed: '2026-02-28' }]);
  expect(await loadPlayerHistory('164')).toHaveLength(1);
  expect(global.fetch).toHaveBeenCalledTimes(1);
});

test('shows players from players.json and tells same-name players apart', async () => {
  mockFetch({ '/data/players.json': { body: playersDoc } });
  render(<App />);
  expect(await screen.findByText(/Rating period 427/)).toBeInTheDocument();
  expect((await screen.findAllByText('WANG Eugene Zhen')).length).toBeGreaterThan(0);

  fireEvent.change(screen.getByPlaceholderText('Enter your name...'), { target: { value: 'li wei' } });
  expect(await screen.findByText('ON · 1500')).toBeInTheDocument();
  expect(screen.getByText('BC · 1200')).toBeInTheDocument();
});

test('a history failure stays in the history section', async () => {
  mockFetch({ '/data/players.json': { body: playersDoc }, '/data/history/56.json': { status: 500 } });
  render(<App />);
  await screen.findByText(/Rating period 427/);

  fireEvent.change(screen.getByPlaceholderText('Enter your name...'), { target: { value: 'wang' } });
  fireEvent.mouseDown(await screen.findByText('ON · 4071'));

  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Failed to load rating history'));
  expect(screen.getByPlaceholderText('Enter your name...')).toBeInTheDocument();
});
