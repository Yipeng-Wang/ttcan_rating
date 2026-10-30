import json
from pathlib import Path

import pytest
from bs4 import BeautifulSoup

import scrapping as s

FIXTURES = Path(__file__).parent / "fixtures"


def fixture(name):
    return (FIXTURES / name).read_bytes()


def test_listing_page_parses_players_with_ids():
    players = s.parse_listing_page(fixture("listing_page1.html"))
    assert len(players) == 100
    first = players[0]
    assert first["id"] == "7864"
    assert first["name"] == "WANG Eugene Zhen"
    assert first["province"] == "ON"
    assert first["gender"] == "M"
    assert isinstance(first["rating"], int)
    assert first["lastPlayed"] == "2026-09-07"
    assert all(p["id"] for p in players)


def test_listing_page_reports_total_pages():
    assert s.parse_total_pages(fixture("listing_page1.html")) == 80


def test_page_past_the_end_has_no_players():
    assert s.parse_listing_page(fixture("listing_past_end.html")) == []


def test_unexpected_page_is_not_mistaken_for_the_end():
    assert s.parse_listing_page(b"<html><body>Service Unavailable</body></html>") is None


def test_latest_period_comes_from_dropdown():
    assert s.find_latest_period(fixture("listing_page1.html")) == "427"


def test_history_is_not_duplicated_by_nested_tables():
    soup = BeautifulSoup(fixture("player_7864.html"), "html.parser")
    history = s.extract_history(soup)
    periods = [entry[0] for entry in history]
    assert len(periods) == len(set(periods)) > 10
    assert [426, "2026-09-07", 4071] in history
    assert history == sorted(history, key=lambda e: e[1])
    assert all(int(e[1][:4]) > s.HISTORY_CUTOFF_YEAR for e in history)


def test_birth_year():
    soup = BeautifulSoup(fixture("player_7864.html"), "html.parser")
    assert s.extract_birth_year(soup) == 1985


def test_player_id_from_link():
    assert s.player_id_from_link("ctta_ratings1.asp?Player_ID=7864&Period=426&") == "7864"
    assert s.player_id_from_link(None) is None


def test_dedupe_by_id_keeps_same_name_players():
    players = [
        {"id": "1", "name": "LI Wei", "province": "ON", "rating": 1500},
        {"id": "2", "name": "LI Wei", "province": "BC", "rating": 1200},
        {"id": "1", "name": "LI Wei", "province": "ON", "rating": 1500},
    ]
    assert [p["id"] for p in s.dedupe_players(players)] == ["1", "2"]


class FakeFetcher:
    def __init__(self, pages):
        self.pages = pages

    def get(self, url, params=None, cache_key=None):
        page = self.pages[params["Formv_ctta_ratings_Page"]]
        if isinstance(page, Exception):
            raise page
        return page


def test_scrape_listing_fails_instead_of_stopping_early(monkeypatch):
    monkeypatch.setattr(s, "PAGE_DELAY", 0)
    page1 = fixture("listing_page1.html")
    fetcher = FakeFetcher({1: page1, 2: s.ScrapeError("timeout")})
    with pytest.raises(s.ScrapeError):
        s.scrape_listing(fetcher, "427", max_pages=None)

    fetcher = FakeFetcher({1: page1, 2: fixture("listing_past_end.html")})
    with pytest.raises(s.ScrapeError, match="no players"):
        s.scrape_listing(fetcher, "427", max_pages=None)


def test_scrape_listing_respects_max_pages(monkeypatch):
    monkeypatch.setattr(s, "PAGE_DELAY", 0)
    fetcher = FakeFetcher({1: fixture("listing_page1.html")})
    assert len(s.scrape_listing(fetcher, "427", max_pages=1)) == 100


def _players(n):
    return [{"id": str(i), "name": f"P{i}", "province": "ON", "gender": "M", "rating": 1000 + i,
             "lastPlayed": "2026-01-01"} for i in range(n)]


def test_publish_writes_shards_and_swaps_atomically(tmp_path):
    out = tmp_path / "data"
    history = {"7": [[1, "2020-01-01", 1000]], "71": [[1, "2020-01-01", 900]]}
    s.publish(s.build_output(_players(100), history, "427", "test"), out)
    doc = json.loads((out / "players.json").read_text())
    assert doc["period"] == "427" and len(doc["players"]) == 100
    assert doc["players"][0]["rating"] == 1099
    shard = json.loads((out / f"history/{s.shard_of('7')}.json").read_text())
    assert shard["7"] == [[1, "2020-01-01", 1000]] and shard["71"] == [[1, "2020-01-01", 900]]
    assert not (tmp_path / "data.staging").exists() and not (tmp_path / "data.old").exists()


def test_publish_refuses_a_sharp_drop(tmp_path):
    out = tmp_path / "data"
    s.publish(s.build_output(_players(100), {}, "427", "test"), out)
    with pytest.raises(s.ScrapeError, match="not publishing"):
        s.publish(s.build_output(_players(50), {}, "428", "test"), out)
    assert json.loads((out / "players.json").read_text())["period"] == "427"
    s.publish(s.build_output(_players(50), {}, "428", "test"), out, force=True)
    assert json.loads((out / "players.json").read_text())["period"] == "428"


def test_publish_without_history_keeps_existing_history(tmp_path):
    out = tmp_path / "data"
    s.publish(s.build_output(_players(10), {"7": [[1, "2020-01-01", 1000]]}, "427", "test"), out)
    s.publish(s.build_output(_players(10), {}, "428", "test"), out, keep_history=True)
    assert (out / f"history/{s.shard_of('7')}.json").exists()


def test_skip_if_current_does_not_scrape(tmp_path, monkeypatch):
    out = tmp_path / "data"
    s.publish(s.build_output(_players(10), {}, "427", "test"), out)
    monkeypatch.setattr(s, "BACKEND_DIR", tmp_path)
    monkeypatch.setattr(s, "scrape", lambda *a, **k: pytest.fail("should not scrape"))
    assert s.main(["--period", "427", "--skip-if-current", "--out", str(out)]) == 0


def test_gender_codes_are_normalised():
    row = ('<tr><td>{n}</td><td><a href="ctta_ratings1.asp?Player_ID={n}&Period=1&">X Y</a></td><td>QC</td>'
           '<td>{g}</td><td>1686</td><td>398</td><td>4/30/2024</td><td></td></tr>')
    codes = [("m", "M"), ("f", "F"), ("H", "M"), ("?", ""), ("", "")]
    rows = "".join(row.format(n=i, g=code) for i, (code, _) in enumerate(codes))
    html = f'<table class="resultTable"><tr><th>Serial</th></tr>{rows}</table>'.encode()
    players = s.parse_listing_page(html)
    assert [p["gender"] for p in players] == [expected for _, expected in codes]


class PlayerFetcher:
    def __init__(self, pages):
        self.pages, self.calls = pages, []

    def get(self, url, params=None, cache_key=None):
        page = int((params or {}).get("Formv_ctta_ratings_Page", 1))
        self.calls.append(page)
        return self.pages[page]


def test_player_history_follows_pages():
    fetcher = PlayerFetcher({1: fixture("player_7946_p1.html"), 2: fixture("player_7946_p2.html")})
    birth_year, history = s.scrape_player(fetcher, {"id": "7946", "link": "ctta_ratings1.asp?Player_ID=7946&Period=427&"}, True)
    assert fetcher.calls == [1, 2]
    assert len(history) == 127
    assert history[0][1] == "2011-01-01" and history[-1][0] == 427


def test_short_history_fetches_one_page():
    fetcher = PlayerFetcher({1: fixture("player_7864.html")})
    s.scrape_player(fetcher, {"id": "7864", "link": "ctta_ratings1.asp?Player_ID=7864&Period=426&"}, True)
    assert fetcher.calls == [1]


def test_history_paging_stops_when_site_repeats_page_one():
    page1 = fixture("player_7946_p1.html")
    fetcher = PlayerFetcher({1: page1, 2: page1})
    _, history = s.scrape_player(fetcher, {"id": "7946", "link": "x?Player_ID=7946"}, True)
    assert fetcher.calls == [1, 2] and len(history) == 100


def test_player_page_urls_have_a_clean_query_string():
    import requests
    link = "ctta_ratings1.asp?Player_ID=18702&Period=422&"
    for page in (1, 2):
        url, params = s.player_page_request(link, page)
        prepared = requests.Request("GET", url, params=params).prepare().url
        assert "&&" not in prepared and "Player_ID=18702" in prepared
    assert prepared.endswith("Formv_ctta_ratings_Page=2")


def test_placeholder_birth_years_are_ignored():
    assert s.extract_birth_year(BeautifulSoup("Year of Birth: 1901", "html.parser")) is None
    assert s.extract_birth_year(BeautifulSoup("Year of Birth: 2012", "html.parser")) == 2012
