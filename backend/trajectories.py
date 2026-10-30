"""Find players whose rating grew the way another player's has, so the site can show how they kept growing.

Players are lined up by age when the birth year is known, otherwise by years since their
first rating. Each history is resampled onto a quarter-year grid. A "path" match had a
similar rating over the two years before the player's latest rating; a "level" match (the
fallback for newer players) simply had the same rating at the same point. Every match must
have ratings one and two years after the matching point, so there is something to learn from.
"""

import math
from collections import defaultdict
from datetime import date
from typing import Dict, List, Optional, Tuple

STEP = 0.25            # grid size in years
MAX_GAP = 1.5          # don't interpolate across longer breaks
WINDOW_BINS = 8        # two years of history before the matching point
MIN_PATH_BINS = 5      # a path needs at least a year of recent history
PATH_RATING_DIFF = 150
PATH_MAX_RMS = 120
LEVEL_RATING_DIFF = 50
FUTURE_BINS = (4, 8)   # ratings needed 1 and 2 years after the matching point
MATCHES = 3
ACTIVE_YEARS = 2


def years(iso: str) -> float:
    y, m, d = (int(x) for x in iso.split("-"))
    return y + (m - 1) / 12 + (d - 1) / 365


def axis(history: List[List], birth_year: Optional[int]) -> Tuple[str, List[Tuple[float, int]]]:
    """[(x, rating)] where x is age, or years since the first rating."""
    if birth_year:
        return "age", [(years(d) - birth_year, r) for _, d, r in history]
    start = years(history[0][1])
    return "career", [(years(d) - start, r) for _, d, r in history]


def resample(points: List[Tuple[float, int]]) -> Dict[int, float]:
    """Linear interpolation onto the grid, skipping long breaks. Always includes the last point."""
    grid: Dict[int, float] = {}
    for (x0, r0), (x1, r1) in zip(points, points[1:]):
        if x1 - x0 > MAX_GAP:
            continue
        b = math.ceil(x0 / STEP - 1e-9)
        while b * STEP <= x1 + 1e-9:
            x = b * STEP
            grid[b] = r1 if x1 == x0 else r0 + (r1 - r0) * (x - x0) / (x1 - x0)
            b += 1
    if points:
        grid.setdefault(round(points[-1][0] / STEP), float(points[-1][1]))
    return grid


def find_similar(players: List[Dict], history: Dict[str, List[List]], today: Optional[date] = None) -> Dict[str, List[Dict]]:
    """{player id: [{"id", "by", "at", "match"}...]} for players active in the last two years."""
    today = today or date.today()
    cutoff = date(today.year - ACTIVE_YEARS, today.month, min(today.day, 28)).isoformat()
    by_id = {p["id"]: p for p in players}

    grids: Dict[str, Dict[int, float]] = {}
    modes: Dict[str, str] = {}
    index: Dict[Tuple[str, int], List[Tuple[str, float]]] = defaultdict(list)
    for pid, entries in history.items():
        if pid not in by_id or not entries:
            continue
        mode, points = axis(entries, by_id[pid].get("birthYear"))
        grid = resample(points)
        grids[pid], modes[pid] = grid, mode
        for b, rating in grid.items():
            index[(mode, b)].append((pid, rating))

    def has_future(q: str, end: int) -> bool:
        return all(end + f in grids[q] for f in FUTURE_BINS)

    results: Dict[str, List[Dict]] = {}
    for pid, grid in grids.items():
        if by_id[pid].get("lastPlayed", "") < cutoff:
            continue
        mode = modes[pid]
        end = max(grid)
        current = grid[end]
        recent = {b: grid[b] for b in range(end - WINDOW_BINS, end + 1) if b in grid}
        candidates = [(q, r) for q, r in index[(mode, end)] if q != pid and has_future(q, end)]

        matches: List[Tuple[float, str, str]] = []
        if len(recent) >= MIN_PATH_BINS:
            for q, rating in candidates:
                if abs(rating - current) > PATH_RATING_DIFF:
                    continue
                common = [b for b in recent if b in grids[q]]
                if len(common) < 0.7 * len(recent):
                    continue
                rms = math.sqrt(sum((recent[b] - grids[q][b]) ** 2 for b in common) / len(common))
                if rms <= PATH_MAX_RMS:
                    matches.append((rms, q, "path"))
        if len(matches) < MATCHES:
            taken = {q for _, q, _ in matches}
            level = sorted(
                (abs(rating - current) + 1000, q, "level")  # always ranked after path matches
                for q, rating in candidates
                if q not in taken and abs(rating - current) <= LEVEL_RATING_DIFF
            )
            matches.extend(level)

        matches.sort()
        if matches:
            results[pid] = [
                {"id": q, "by": mode, "at": round(end * STEP, 2), "match": kind}
                for _, q, kind in matches[:MATCHES]
            ]
    return results
