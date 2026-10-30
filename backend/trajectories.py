"""Find players whose rating grew the way another player's has, so the site can show how they kept growing.

Players are lined up by age when the birth year is known, otherwise by years since their
first rating, and only compared with players of the same gender (any gender when the player
has none). Each history is resampled onto a quarter-year grid.

Every player gets three matches, taken from the best tier that has candidates:

  path   similar rating over the two years before the player's latest rating
  level  the same rating (within 50) at the same point
  near   the closest rating at the same point, then within a year of it, then within five

Matches need ratings one and two years after the matching point when possible, and at
least one year after it otherwise. Only when that still leaves fewer than three (the
oldest players, the youngest, very long careers) are matches without later ratings
used, and as a last resort players of any gender.
"""

import math
from collections import defaultdict
from typing import Dict, List, Optional, Tuple

STEP = 0.25            # grid size in years
MAX_GAP = 1.5          # don't interpolate across longer breaks
WINDOW_BINS = 8        # two years of history before the matching point
MIN_PATH_BINS = 5      # a path needs at least a year of recent history
PATH_RATING_DIFF = 150
PATH_MAX_RMS = 120
LEVEL_RATING_DIFF = 50
NEAR_MAX_OFFSET = 4    # first widen the search by up to a year either side
WIDE_MAX_OFFSET = 20   # then by up to five years, for unusual ages and long careers
ANY_AGE_OFFSET = 400   # finally any age, so every player gets three matches
MATCHES = 3
MAX_AGE = 13           # the site shows growth matches to U13 players only


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


def find_similar(players: List[Dict], history: Dict[str, List[List]], current_year: Optional[int] = None,
                 max_age: Optional[int] = MAX_AGE) -> Dict[str, List[Dict]]:
    """{player id: [{"id", "by", "at", "rating", "match"}, ...]} with three matches per U13 player.

    Matches for players aged `max_age` or under this year (pass None for everyone); the
    matched players can be any age now.

    "at" is the matched player's own age (or career year) at the matching point, and
    "rating" their rating there.
    """
    by_id = {p["id"]: p for p in players}

    grids: Dict[str, Dict[int, float]] = {}
    modes: Dict[str, str] = {}
    index: Dict[Tuple[str, str, int], List[Tuple[str, float]]] = defaultdict(list)
    for pid, entries in history.items():
        if pid not in by_id or not entries:
            continue
        mode, points = axis(entries, by_id[pid].get("birthYear"))
        grid = resample(points)
        grids[pid], modes[pid] = grid, mode
        gender = by_id[pid].get("gender") or ""
        for b, rating in grid.items():
            index[(mode, gender, b)].append((pid, rating))
            if gender:
                index[(mode, "", b)].append((pid, rating))  # the any-gender pool

    if current_year is None:
        from datetime import date
        current_year = date.today().year

    def wanted(pid: str) -> bool:
        if max_age is None:
            return True
        birth_year = by_id[pid].get("birthYear")
        return bool(birth_year) and current_year - birth_year <= max_age

    def future(q: str, b: int) -> int:
        """How many of the 1- and 2-year-later points the candidate has."""
        return (b + 4 in grids[q]) + (b + 8 in grids[q])

    results: Dict[str, List[Dict]] = {}
    for pid, grid in grids.items():
        if not wanted(pid):
            continue
        mode = modes[pid]
        gender = by_id[pid].get("gender") or ""
        end = max(grid)
        current = grid[end]
        recent = {b: grid[b] for b in range(end - WINDOW_BINS, end + 1) if b in grid}
        chosen: List[Tuple[str, int, str]] = []  # (candidate, matched bin, kind)

        def take(ranked: List[Tuple[float, str, int, str]]) -> None:
            seen = {q for q, _, _ in chosen}
            for _, q, b, kind in sorted(ranked):
                if len(chosen) == MATCHES:
                    return
                if q not in seen:
                    chosen.append((q, b, kind))
                    seen.add(q)

        same_point = [(q, r) for q, r in index[(mode, gender, end)] if q != pid]

        # 1. similar climb over the last two years, with two years to look ahead
        if len(recent) >= MIN_PATH_BINS:
            ranked = []
            for q, rating in same_point:
                if abs(rating - current) > PATH_RATING_DIFF or future(q, end) < 2:
                    continue
                common = [b for b in recent if b in grids[q]]
                if len(common) < 0.7 * len(recent):
                    continue
                rms = math.sqrt(sum((recent[b] - grids[q][b]) ** 2 for b in common) / len(common))
                if rms <= PATH_MAX_RMS:
                    ranked.append((rms, q, end, "path"))
            take(ranked)

        # 2. same rating at the same point, two years to look ahead
        if len(chosen) < MATCHES:
            take([(abs(r - current), q, end, "level") for q, r in same_point
                  if abs(r - current) <= LEVEL_RATING_DIFF and future(q, end) == 2])

        # 3. closest rating at the same point; prefer two years ahead, accept one
        if len(chosen) < MATCHES:
            take([(abs(r - current) + (0 if future(q, end) == 2 else 10_000), q, end, "near")
                  for q, r in same_point if future(q, end) >= 1])

        def widen(pool_gender: str, max_offset: int, min_future: int, start: int = 1) -> None:
            offset = start
            while len(chosen) < MATCHES and offset <= max_offset:
                ranked = []
                for b in {end - offset, end + offset}:
                    for q, r in index[(mode, pool_gender, b)]:
                        if q != pid and future(q, b) >= min_future:
                            ranked.append((abs(r - current), q, b, "near"))
                take(ranked)
                offset += 1

        # 4. widen to within a year, then five years, of the same point
        widen(gender, NEAR_MAX_OFFSET, 1)
        widen(gender, WIDE_MAX_OFFSET, 1, start=NEAR_MAX_OFFSET + 1)
        # 5. last resorts: matches without later ratings, then any gender, then the closest ages at all
        widen(gender, WIDE_MAX_OFFSET, 0, start=0)
        if gender:
            widen("", WIDE_MAX_OFFSET, 0, start=0)
        widen("", ANY_AGE_OFFSET, 0, start=WIDE_MAX_OFFSET + 1)

        if chosen:
            results[pid] = [
                {"id": q, "by": mode, "at": round(b * STEP, 2), "rating": round(grids[q][b]), "match": kind}
                for q, b, kind in chosen
            ]
    return results


def yearly_growth(history: Dict[str, List[List]]) -> Dict[str, Dict]:
    """Rating change over the 12 months before the latest rating period.

    {player id: {"growth": change, "growthSince": date of the rating a year ago}} for players
    who have played in the last year and whose rating a year ago is recent enough to compare
    (from within six months of that date). Players first rated less than 18 months ago are left
    out: their early ratings jump while TTCAN calibrates them.
    """
    dates = [e[1] for entries in history.values() for e in entries]
    if not dates:
        return {}
    latest = max(dates)
    y, m, d = (int(x) for x in latest.split("-"))
    cutoff = f"{y - 1:04d}-{m:02d}-{d:02d}"
    six_months_earlier = f"{y - 2 if m <= 6 else y - 1:04d}-{(m - 7) % 12 + 1:02d}-{d:02d}"
    growth: Dict[str, Dict] = {}
    for pid, entries in history.items():
        if not entries or entries[0][1] > six_months_earlier:
            continue  # rated for less than 18 months
        base = None
        for entry in entries:
            if entry[1] <= cutoff:
                base = entry
        last = entries[-1]
        if base is None or base[1] < six_months_earlier or last[1] <= cutoff:
            continue
        growth[pid] = {"growth": last[2] - base[2], "growthSince": base[1]}
    return growth
