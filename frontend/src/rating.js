// TTCAN rating rules, from "TTCAN Rating System" (2016):
// http://96.31.42.60/upload/TTCANRatingSystem2016.pdf

export const RULES_URL = 'http://96.31.42.60/upload/TTCANRatingSystem2016.pdf';

// 2.3 Points exchange tables: [lowest gap, highest gap, winner gets, loser gets] per star rating.
const EXPECTED_GAPS = [[0, 25], [26, 50], [51, 100], [101, 150], [151, 200], [201, 300], [301, 400], [401, Infinity]];
const UPSET_GAPS = [[0, 24], [25, 49], [50, 99], [100, 149], [150, 199], [200, 299], [300, 399], [400, Infinity]];

const TABLES = {
  1: {
    expected: [[8, -6], [7, -6], [6, -5], [5, -4], [4, -3], [3, -2], [2, -1], [1, 0]],
    upset: [[8, -6], [10, -8], [12, -10], [14, -12], [16, -14], [18, -16], [20, -18], [22, -20]],
  },
  2: {
    expected: [[12, -10], [11, -9], [9, -7], [8, -6], [6, -4], [5, -3], [3, -1], [2, 0]],
    upset: [[12, -10], [15, -13], [18, -16], [21, -19], [24, -22], [27, -25], [30, -28], [33, -31]],
  },
  3: {
    expected: [[16, -13], [14, -11], [12, -9], [10, -7], [8, -5], [6, -3], [4, -1], [2, 0]],
    upset: [[16, -13], [20, -17], [24, -21], [28, -25], [32, -29], [36, -33], [40, -37], [44, -41]],
  },
  4: {
    expected: [[20, -16], [18, -14], [15, -11], [13, -9], [10, -7], [8, -5], [5, -2], [3, 0]],
    upset: [[20, -16], [25, -21], [30, -26], [35, -31], [40, -36], [45, -41], [50, -45], [55, -50]],
  },
};

/** Rows of one exchange table, for showing it on the page. */
export function exchangeTable(stars, kind) {
  const gaps = kind === 'expected' ? EXPECTED_GAPS : UPSET_GAPS;
  return TABLES[stars][kind].map(([winner, loser], i) => ({ from: gaps[i][0], to: gaps[i][1], winner, loser }));
}

function lookup(stars, kind, gap) {
  const gaps = kind === 'expected' ? EXPECTED_GAPS : UPSET_GAPS;
  const row = gaps.findIndex(([lo, hi]) => gap >= lo && gap <= hi);
  return TABLES[stars][kind][row];
}

/**
 * Points for one match, from the player's point of view.
 * opponentStatus: 'rated' | 'temporary' (a T rating) | 'unrated'
 * Returns { points, reason, kind, gap }.
 */
export function matchPoints({ myRating, opponentRating, won, stars, opponentStatus = 'rated' }) {
  if (opponentStatus === 'unrated') {
    return { points: 0, kind: 'unrated', gap: null, reason: 'No points against unrated players (rule 1.3)' };
  }
  const winner = won ? myRating : opponentRating;
  const loser = won ? opponentRating : myRating;
  const gap = Math.abs(winner - loser);
  // Equal ratings fall in the first row of both tables, which hold the same points.
  const kind = winner >= loser ? 'expected' : 'upset';
  const [winnerPoints, loserPoints] = lookup(stars, kind, gap);

  if (!won && opponentStatus === 'temporary') {
    return { points: 0, kind, gap, reason: 'Losing to a player with a T rating costs no points (rule 3.6)' };
  }
  const points = won ? winnerPoints : loserPoints;
  const who = kind === 'expected'
    ? (won ? 'Expected win' : 'Expected loss')
    : (won ? 'Upset win' : 'Upset loss');
  const side = gap === 0 ? 'same rating' : `${gap} points ${myRating > opponentRating ? 'higher' : 'lower'}`;
  return { points, kind, gap, reason: `${who} · you were ${side}` };
}

/** Total change for a tournament: every match uses the ratings going into the event. */
export function tournamentChange(myRating, stars, matches) {
  const results = matches.map(m => ({ ...m, ...matchPoints({ myRating, stars, ...m }) }));
  const total = results.reduce((sum, r) => sum + r.points, 0);
  return { results, total, newRating: myRating + total };
}

/**
 * Temporary ('T') rating for a new player (rules 3.1-3.4), from the ratings of the rated
 * players they beat and lost to. Returns { rating, rule } or null with no rated results.
 */
export function temporaryRating(winsAgainst, lossesAgainst) {
  if (!winsAgainst.length && !lossesAgainst.length) return null;
  if (!winsAgainst.length) return { rating: 100, rule: '3.4', reason: 'No wins yet, so the T rating starts at 100' };
  const highestWin = Math.max(...winsAgainst);
  if (!lossesAgainst.length) {
    return { rating: highestWin + 100, rule: '3.3', reason: 'No losses: your best win plus 100' };
  }
  const lowestLoss = Math.min(...lossesAgainst);
  if (lowestLoss > highestWin) {
    return { rating: highestWin, rule: '3.1', reason: 'Every loss was to someone rated above your best win: your best win' };
  }
  return {
    rating: Math.round((highestWin + lowestLoss) / 2),
    rule: '3.2',
    reason: 'Halfway between your best win and your lowest loss',
  };
}

/** Rule 3.5: a T rating becomes regular after 5 wins and 1 loss, or 15 wins. */
export function leavesTemporary(wins, losses) {
  return (wins >= 5 && losses >= 1) || wins >= 15;
}
