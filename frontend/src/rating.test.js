import { exchangeTable, leavesTemporary, matchPoints, temporaryRating, tournamentChange } from './rating';

const pts = (myRating, opponentRating, won, stars = 1, opponentStatus) =>
  matchPoints({ myRating, opponentRating, won, stars, opponentStatus }).points;

test('expected results use the expected table', () => {
  expect(pts(1500, 1380, true)).toBe(5);        // 120 higher, 1 star: winner +5
  expect(pts(1380, 1500, false)).toBe(-4);      // same match from the loser's side
  expect(pts(2000, 1500, true, 4)).toBe(3);     // 401+ gap, 4 stars
  expect(pts(1500, 2000, false, 4)).toBe(0);
  expect(pts(1225, 1200, true, 2)).toBe(12);    // 25 gap is the 0-25 row
  expect(pts(1226, 1200, true, 2)).toBe(11);    // 26 gap is the 26-50 row
});

test('upsets use the unexpected table and its own boundaries', () => {
  expect(pts(1380, 1500, true)).toBe(14);       // 120 lower wins, 1 star
  expect(pts(1500, 1380, false)).toBe(-12);
  expect(pts(1200, 1225, true, 2)).toBe(15);    // 25 gap is the 25-49 row for upsets
  expect(pts(1200, 1224, true, 2)).toBe(12);
  expect(pts(1000, 1500, true, 3)).toBe(44);    // 400+
  expect(pts(1500, 1000, false, 3)).toBe(-41);
});

test('equal ratings exchange the first-row points', () => {
  expect(pts(1500, 1500, true, 3)).toBe(16);
  expect(pts(1500, 1500, false, 3)).toBe(-13);
});

test('unrated and temporary opponents follow rules 1.3 and 3.6', () => {
  expect(pts(1500, 1400, true, 1, 'unrated')).toBe(0);
  expect(pts(1500, 1400, false, 1, 'unrated')).toBe(0);
  expect(pts(1500, 1400, true, 1, 'temporary')).toBe(6);
  expect(pts(1500, 1400, false, 1, 'temporary')).toBe(0);
  expect(matchPoints({ myRating: 1500, opponentRating: 1400, won: false, stars: 1, opponentStatus: 'temporary' }).reason).toMatch(/3\.6/);
});

test('a tournament adds every match using the starting rating', () => {
  const { results, total, newRating } = tournamentChange(1500, 2, [
    { opponentRating: 1380, won: true },   // expected win, gap 120: +8
    { opponentRating: 1650, won: true },   // upset win, gap 150: +24
    { opponentRating: 1450, won: false },  // upset loss, gap 50: -16
  ]);
  expect(results.map(r => r.points)).toEqual([8, 24, -16]);
  expect(total).toBe(16);
  expect(newRating).toBe(1516);
  expect(results[1].reason).toBe('Upset win · you were 150 points lower');
});

test('temporary ratings match the examples in the rules', () => {
  expect(temporaryRating([1950, 1998, 2010], [2050])).toMatchObject({ rating: 2010, rule: '3.1' });  // Jean
  expect(temporaryRating([1145, 1070, 1210], [1100])).toMatchObject({ rating: 1155, rule: '3.2' });  // Wing
  expect(temporaryRating([900, 1000], [])).toMatchObject({ rating: 1100, rule: '3.3' });
  expect(temporaryRating([], [800])).toMatchObject({ rating: 100, rule: '3.4' });
  expect(temporaryRating([], [])).toBeNull();
  expect(leavesTemporary(5, 1)).toBe(true);
  expect(leavesTemporary(5, 0)).toBe(false);
  expect(leavesTemporary(15, 0)).toBe(true);
});

test('tables are exposed with their ranges for display', () => {
  expect(exchangeTable(1, 'expected')[0]).toEqual({ from: 0, to: 25, winner: 8, loser: -6 });
  expect(exchangeTable(4, 'upset')[7]).toEqual({ from: 400, to: Infinity, winner: 55, loser: -50 });
});
