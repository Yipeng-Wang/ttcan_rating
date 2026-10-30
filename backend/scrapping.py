"""Scrape TTCAN player ratings and publish them as static JSON for the frontend.

Output (default: ../frontend/public/data):
    players.json          all players in the current rating period
    history/<shard>.json  rating history, sharded by player ID

Every page fetched from TTCAN is cached under backend/.cache/<period>/, so an
interrupted run picks up where it stopped when you run it again.
"""

import argparse
import concurrent.futures
import json
import logging
import os
import re
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple
from urllib.parse import parse_qs, parse_qsl, urljoin, urlparse

import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

from trajectories import find_similar, yearly_growth

load_dotenv()

logger = logging.getLogger("ttcan")

BACKEND_DIR = Path(__file__).resolve().parent
DEFAULT_OUT_DIR = BACKEND_DIR.parent / "frontend" / "public" / "data"
CACHE_ROOT = BACKEND_DIR / ".cache"

BASE_URL = os.getenv("TTCAN_BASE_URL", "http://96.31.42.60/ratingSystem/ctta_ratings3.asp")
CATEGORY_CODE = os.getenv("CATEGORY_CODE", "1")

MAX_RETRIES = 4
REQUEST_TIMEOUT = 30
PAGE_DELAY = 0.2
CONCURRENT_WORKERS = 8
HISTORY_CUTOFF_YEAR = 2010
MAX_RATING = 5000
HISTORY_SHARDS = 64
HISTORY_PAGE_SIZE = 100  # player pages list at most this many periods per page
MAX_HISTORY_PAGES = 10
GENDER_CODES = {"M": "M", "F": "F", "H": "M"}  # 'H' (homme) appears on some French entries
# Refuse to publish if the new player count drops below this share of the last one.
MIN_PLAYER_RATIO = 0.9


class ScrapeError(RuntimeError):
    """Raised when TTCAN returns something we cannot trust."""


# ==== PARSING ====

def parse_us_date(text: str) -> Optional[str]:
    """'7/31/2025' -> '2025-07-31'."""
    try:
        return datetime.strptime(text.strip(), "%m/%d/%Y").date().isoformat()
    except ValueError:
        return None


def parse_long_date(text: str) -> Optional[str]:
    """'October 5, 2024' -> '2024-10-05'."""
    try:
        return datetime.strptime(text.strip(), "%B %d, %Y").date().isoformat()
    except ValueError:
        return None


def player_id_from_link(link: Optional[str]) -> Optional[str]:
    if not link:
        return None
    values = parse_qs(urlparse(link).query).get("Player_ID")
    if values and values[0].isdigit():
        return values[0]
    return None


def parse_total_pages(html: bytes) -> Optional[int]:
    """Read the page count from the pager ('... of 80')."""
    match = re.search(r"\bof\s+(\d+)\s*\]", BeautifulSoup(html, "html.parser").get_text())
    return int(match.group(1)) if match else None


def parse_listing_page(html: bytes) -> Optional[List[Dict]]:
    """Parse one ratings listing page.

    Returns None when the page has no results table at all (an unexpected page),
    and an empty list when the table exists but has no player rows (past the end).
    """
    soup = BeautifulSoup(html, "html.parser")
    table = soup.find("table", class_="resultTable")
    if table is None:
        return None

    players = []
    for row in table.find_all("tr")[1:]:
        cols = row.find_all("td")
        if len(cols) < 7:
            continue  # pagination / footer rows
        link_tag = cols[1].find("a")
        link = link_tag.get("href") if link_tag else None
        name = cols[1].get_text(strip=True)
        rating = cols[4].get_text(strip=True)
        gender = GENDER_CODES.get(cols[3].get_text(strip=True).upper(), "")
        last_played = parse_us_date(cols[6].get_text(strip=True))
        if not name or not rating.isdigit() or not last_played:
            continue
        players.append({
            "id": player_id_from_link(link),
            "name": name,
            "province": cols[2].get_text(strip=True),
            "gender": gender,
            "rating": int(rating),
            "period": cols[5].get_text(strip=True),
            "lastPlayed": last_played,
            "temporary": len(cols) > 7 and cols[7].get_text(strip=True) == "T",
            "link": link,
        })
    return players


def find_latest_period(html: bytes) -> Optional[str]:
    """Pick the newest rating period from the period dropdown on the listing page."""
    soup = BeautifulSoup(html, "html.parser")
    select = soup.find("select", attrs={"name": re.compile("period", re.I)})
    if select is None:
        return None
    ids = [opt.get("value", "").strip() for opt in select.find_all("option")]
    ids = [int(v) for v in ids if v.isdigit()]
    return str(max(ids)) if ids else None


BIRTH_YEAR_PATTERNS = [
    r"Year of Birth:\s*(\d{4})",
    r"(?:DOB|Date of Birth):\s*(\d{4})-\d{2}-\d{2}",
    r"Born:\s*(\d{4})",
]


def extract_birth_year(soup: BeautifulSoup) -> Optional[int]:
    """Birth year rather than age, so the published data never goes stale."""
    text = soup.get_text(" ")
    for pattern in BIRTH_YEAR_PATTERNS:
        match = re.search(pattern, text, re.IGNORECASE)
        if match:
            year = int(match.group(1))
            # 1901 and similar are placeholders for an unknown birth date
            if datetime.now().year - 100 < year <= datetime.now().year - 3:
                return year
    return None


def history_rows(soup: BeautifulSoup) -> Dict[int, Tuple[str, str]]:
    """{periodId: (period date text, rating text)} for every period row on one page.

    Player pages nest one table inside another, so only leaf tables are read.
    """
    rows: Dict[int, Tuple[str, str]] = {}
    for table in soup.find_all("table"):
        if table.find("table") is not None:
            continue  # wrapper table; its rows repeat the inner table's rows
        for row in table.find_all("tr"):
            cols = [c.get_text(strip=True) for c in row.find_all(["td", "th"])]
            if len(cols) >= 5 and cols[0].isdigit() and cols[4].isdigit():
                rows[int(cols[0])] = (cols[1], cols[4])
    return rows


def extract_history(*soups: BeautifulSoup) -> List[List]:
    """Return [[periodId, 'YYYY-MM-DD', rating], ...] sorted oldest first, from one or more pages."""
    by_period: Dict[int, List] = {}
    for soup in soups:
        for period_id, (period_date, rating) in history_rows(soup).items():
            date = parse_long_date(period_date)
            if not date or int(date[:4]) <= HISTORY_CUTOFF_YEAR or int(rating) >= MAX_RATING:
                continue
            by_period[period_id] = [period_id, date, int(rating)]
    return sorted(by_period.values(), key=lambda entry: (entry[1], entry[0]))


# ==== FETCHING ====

class Fetcher:
    """HTTP GET with retries and an on-disk cache, so reruns resume for free."""

    def __init__(self, cache_dir: Optional[Path]):
        self.cache_dir = cache_dir
        self.session = requests.Session()
        self.session.headers["User-Agent"] = "ttcan-rating-analysis (+https://github.com/Yipeng-Wang/ttcan_rating)"
        if cache_dir:
            cache_dir.mkdir(parents=True, exist_ok=True)

    def get(self, url: str, params: Optional[Dict] = None, cache_key: Optional[str] = None) -> bytes:
        cache_file = self.cache_dir / f"{cache_key}.html" if (self.cache_dir and cache_key) else None
        if cache_file and cache_file.exists():
            return cache_file.read_bytes()

        for attempt in range(MAX_RETRIES):
            try:
                response = self.session.get(url, params=params, timeout=REQUEST_TIMEOUT)
                response.raise_for_status()
                break
            except requests.RequestException as e:
                if attempt == MAX_RETRIES - 1:
                    raise ScrapeError(f"GET {url} {params or ''} failed after {MAX_RETRIES} attempts: {e}") from e
                wait = 2 ** (attempt + 1)
                logger.warning("Request failed (%s), retrying in %ss", e, wait)
                time.sleep(wait)

        if cache_file:
            tmp = cache_file.with_suffix(".tmp")
            tmp.write_bytes(response.content)
            tmp.replace(cache_file)
        return response.content


def listing_params(period: str, page: int) -> Dict:
    return {
        "Category_code": CATEGORY_CODE,
        "Period_Issued": period,
        "Sex": "",
        "activity": "ALL",  # the site defaults to players active in the last 24 months
        "Formv_ctta_ratings_Page": page,
    }


def detect_period(fetcher: Fetcher) -> str:
    html = fetcher.get(BASE_URL, params={"Category_code": CATEGORY_CODE})
    period = find_latest_period(html)
    if not period:
        raise ScrapeError("Could not find the latest rating period on the TTCAN page; pass --period")
    return period


def scrape_listing(fetcher: Fetcher, period: str, max_pages: Optional[int]) -> List[Dict]:
    players: List[Dict] = []
    total_pages = None
    page = 1
    while True:
        html = fetcher.get(BASE_URL, params=listing_params(period, page), cache_key=f"list_{page}")
        page_players = parse_listing_page(html)
        if page_players is None:
            raise ScrapeError(f"Listing page {page} has no results table")
        if total_pages is None:
            total_pages = parse_total_pages(html)
            if total_pages is None:
                raise ScrapeError("Could not read the page count from the listing pager")
            logger.info("Period %s has %s listing pages", period, total_pages)
        if not page_players:
            raise ScrapeError(f"Listing page {page} of {total_pages} has no players")
        players.extend(page_players)
        logger.info("Page %s/%s: %s players (total %s)", page, total_pages, len(page_players), len(players))
        last = total_pages if max_pages is None else min(total_pages, max_pages)
        if page >= last:
            return players
        page += 1
        time.sleep(PAGE_DELAY)


def player_page_request(link: str, page: int = 1) -> Tuple[str, Dict[str, str]]:
    """Split a player link into (url, params) so requests builds a clean query string.

    TTCAN links end in '&'. Appending params to them gives '...&&Formv_...', and
    the server then silently ignores the page number.
    """
    parsed = urlparse(urljoin(BASE_URL, link))
    params = dict(parse_qsl(parsed.query))
    if page > 1:
        params["Formv_ctta_ratings_Page"] = str(page)
    return parsed._replace(query="").geturl(), params


def scrape_player(fetcher: Fetcher, player: Dict, with_history: bool) -> Tuple[Optional[int], List[List]]:
    url, params = player_page_request(player["link"])
    soup = BeautifulSoup(fetcher.get(url, params=params, cache_key=f"player_{player['id']}"), "html.parser")
    birth_year = extract_birth_year(soup)
    if not with_history:
        return birth_year, []

    # History is paginated. The pager only shows the current page number, so keep
    # going while pages come back full.
    pages = [soup]
    while len(history_rows(pages[-1])) >= HISTORY_PAGE_SIZE and len(pages) < MAX_HISTORY_PAGES:
        page = len(pages) + 1
        page_url, page_params = player_page_request(player["link"], page)
        html = fetcher.get(page_url, params=page_params, cache_key=f"player_{player['id']}_p{page}")
        next_soup = BeautifulSoup(html, "html.parser")
        if not set(history_rows(next_soup)) - set().union(*(history_rows(p) for p in pages)):
            break  # no new periods; the site ignored the page parameter
        pages.append(next_soup)
    return birth_year, extract_history(*pages)


def dedupe_players(players: List[Dict]) -> List[Dict]:
    seen = set()
    unique = []
    for p in players:
        key = p["id"] or (p["name"], p["province"], p["rating"])
        if key in seen:
            continue
        seen.add(key)
        unique.append(p)
    return unique


def scrape(fetcher: Fetcher, period: str, with_history: bool, max_pages: Optional[int]) -> Tuple[List[Dict], Dict[str, List]]:
    players = dedupe_players(scrape_listing(fetcher, period, max_pages))
    with_pages = [p for p in players if p["id"] and p["link"]]
    logger.info("%s unique players, fetching %s player pages", len(players), len(with_pages))

    history: Dict[str, List] = {}
    failures = 0
    with concurrent.futures.ThreadPoolExecutor(max_workers=CONCURRENT_WORKERS) as pool:
        futures = {pool.submit(scrape_player, fetcher, p, with_history): p for p in with_pages}
        for i, future in enumerate(concurrent.futures.as_completed(futures), 1):
            player = futures[future]
            try:
                birth_year, entries = future.result()
            except ScrapeError as e:
                failures += 1
                logger.warning("Player %s (%s): %s", player["name"], player["id"], e)
                continue
            player["birthYear"] = birth_year
            if entries:
                history[player["id"]] = entries
            if i % 500 == 0:
                logger.info("Player pages: %s/%s", i, len(with_pages))

    if with_pages and failures > 0.05 * len(with_pages):
        raise ScrapeError(f"{failures} of {len(with_pages)} player pages failed; rerun to retry them from cache")
    return players, history


# ==== PUBLISHING ====

def shard_of(player_id: str) -> int:
    return int(player_id) % HISTORY_SHARDS


def build_output(players: List[Dict], history: Dict[str, List], period: str, source: str) -> Dict[str, object]:
    """Return {relative path: JSON-serialisable content}."""
    players_doc = {
        "generatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "source": source,
        "period": period,
        "historyShards": HISTORY_SHARDS,
        "players": [
            {
                "id": p["id"],
                "name": p["name"],
                "province": p["province"],
                "gender": p["gender"],
                "rating": p["rating"],
                "lastPlayed": p["lastPlayed"],
                "birthYear": p.get("birthYear"),
                "temporary": p.get("temporary", False),
            }
            for p in sorted(players, key=lambda p: -p["rating"])
        ],
    }
    files: Dict[str, object] = {"players.json": players_doc}
    if history:
        shards: Dict[int, Dict[str, List]] = {}
        for player_id, entries in history.items():
            shards.setdefault(shard_of(player_id), {})[player_id] = entries
        for shard, content in shards.items():
            files[f"history/{shard}.json"] = content
        add_growth(players_doc["players"], history)
        files.update(similar_files(find_similar(players_doc["players"], history)))
    return files


def add_growth(players: List[Dict], history: Dict[str, List]) -> None:
    """Add each player's 12-month rating change (growth, growthSince) where it is known."""
    growth = yearly_growth(history)
    for p in players:
        p.pop("growth", None)
        p.pop("growthSince", None)
        p.update(growth.get(p["id"], {}))


def similar_files(similar: Dict[str, List[Dict]]) -> Dict[str, object]:
    """Shard similar-trajectory matches the same way as history."""
    shards: Dict[int, Dict[str, List[Dict]]] = {}
    for player_id, matches in similar.items():
        shards.setdefault(shard_of(player_id), {})[player_id] = matches
    return {f"similar/{shard}.json": content for shard, content in shards.items()}


def rebuild_derived(out_dir: Path) -> None:
    """Recompute 12-month growth and similar/ from the published data, without scraping."""
    players_path = out_dir / "players.json"
    doc = json.loads(players_path.read_text())
    history: Dict[str, List] = {}
    for shard in (out_dir / "history").glob("*.json"):
        history.update(json.loads(shard.read_text()))

    add_growth(doc["players"], history)
    files = similar_files(find_similar(doc["players"], history))

    staging = out_dir / "similar.staging"
    shutil.rmtree(staging, ignore_errors=True)
    staging.mkdir()
    for rel_path, content in files.items():
        path = staging / rel_path.split("/", 1)[1]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(content, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    tmp = players_path.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    shutil.rmtree(out_dir / "similar", ignore_errors=True)
    staging.rename(out_dir / "similar")
    tmp.replace(players_path)
    logger.info("Updated 12-month growth for %s players and similar matches for %s players",
                sum(1 for p in doc["players"] if "growth" in p), sum(len(c) for c in files.values()))


def published_period(out_dir: Path) -> Optional[str]:
    try:
        return str(json.loads((out_dir / "players.json").read_text())["period"])
    except (OSError, ValueError, KeyError):
        return None


def previous_player_count(out_dir: Path) -> Optional[int]:
    try:
        return len(json.loads((out_dir / "players.json").read_text())["players"])
    except (OSError, ValueError, KeyError):
        return None


def publish(files: Dict[str, object], out_dir: Path, force: bool = False, keep_history: bool = False) -> None:
    """Write files to a staging directory, sanity-check them, then swap it into place."""
    new_count = len(files["players.json"]["players"])
    old_count = previous_player_count(out_dir)
    if old_count and new_count < MIN_PLAYER_RATIO * old_count and not force:
        raise ScrapeError(
            f"Only {new_count} players versus {old_count} last time; not publishing. "
            "Use --force if the drop is real."
        )

    staging = out_dir.with_name(out_dir.name + ".staging")
    shutil.rmtree(staging, ignore_errors=True)
    if keep_history:
        for folder in ("history", "similar"):
            if (out_dir / folder).is_dir():
                shutil.copytree(out_dir / folder, staging / folder)
    for rel_path, content in files.items():
        path = staging / rel_path
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(content, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")

    backup = out_dir.with_name(out_dir.name + ".old")
    shutil.rmtree(backup, ignore_errors=True)
    if out_dir.exists():
        out_dir.rename(backup)
    staging.rename(out_dir)
    shutil.rmtree(backup, ignore_errors=True)
    logger.info("Published %s files to %s (%s players)", len(files), out_dir, new_count)


# ==== CLI ====

def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--history", action="store_true", help="also scrape each player's rating history")
    parser.add_argument("--period", default=os.getenv("PERIOD_ISSUED"),
                        help="rating period ID (default: newest period listed on the TTCAN site)")
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT_DIR, help="output directory")
    parser.add_argument("--max-pages", type=int, help="stop after this many listing pages (for testing)")
    parser.add_argument("--fresh", action="store_true", help="ignore cached pages for this period")
    parser.add_argument("--force", action="store_true", help="publish even if the player count dropped sharply")
    parser.add_argument("--skip-if-current", action="store_true",
                        help="do nothing if the published data already has this rating period")
    parser.add_argument("--rebuild-derived", action="store_true",
                        help="only recompute 12-month growth and similar matches from the published data")
    args = parser.parse_args(argv)

    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        handlers=[logging.FileHandler(BACKEND_DIR / "scraper.log"), logging.StreamHandler(sys.stdout)])

    if args.rebuild_derived:
        rebuild_derived(args.out)
        return 0

    try:
        period = args.period or detect_period(Fetcher(cache_dir=None))
        logger.info("Rating period %s", period)
        if args.skip_if_current and published_period(args.out) == period:
            logger.info("Period %s is already published; nothing to do", period)
            return 0
        cache_dir = CACHE_ROOT / period
        if args.fresh:
            shutil.rmtree(cache_dir, ignore_errors=True)
        fetcher = Fetcher(cache_dir)
        players, history = scrape(fetcher, period, args.history, args.max_pages)
        files = build_output(players, history, period, source=BASE_URL)
        publish(files, args.out, force=args.force or args.max_pages is not None, keep_history=not args.history)
    except ScrapeError as e:
        logger.error("%s", e)
        return 1
    except KeyboardInterrupt:
        logger.info("Interrupted. Pages fetched so far are cached; rerun the same command to continue.")
        return 130
    return 0


if __name__ == "__main__":
    sys.exit(main())
