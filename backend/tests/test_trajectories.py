from datetime import date

import trajectories as t

TODAY = date(2026, 10, 29)


def history(birth_year, start_age, ratings, step_months=6):
    """Ratings every `step_months` starting at `start_age` -> [[period, iso date, rating], ...]."""
    out = []
    for i, rating in enumerate(ratings):
        months = round(start_age * 12) + i * step_months
        year, month = birth_year + months // 12, months % 12 + 1
        out.append([i, f"{year}-{month:02d}-01", rating])
    return out


def player(pid, birth_year, last_played, rating=1000):
    return {"id": pid, "birthYear": birth_year, "lastPlayed": last_played, "rating": rating}


def test_resample_interpolates_and_skips_long_breaks():
    grid = t.resample([(10.0, 1000), (10.5, 1100), (13.0, 1500)])
    assert grid[40] == 1000 and grid[41] == 1050 and grid[42] == 1100
    assert 44 not in grid  # 2.5-year break is not filled in
    assert grid[52] == 1500


def test_path_match_follows_a_similar_climb_and_needs_a_future():
    me = history(2014, 10.0, [800, 900, 1000, 1100, 1200])                      # age 10 to 12, now
    twin = history(2004, 10.0, [790, 905, 990, 1110, 1190, 1300, 1450, 1500, 1600])  # same climb, then 2 more years
    no_future = history(2008, 10.0, [800, 900, 1000, 1100, 1200, 1210])          # stops half a year later
    faller = history(2000, 10.0, [1300, 1250, 1200, 1200, 1200, 1250, 1300, 1300, 1350])  # same rating, different path
    players = [player("me", 2014, "2026-01-01"), player("twin", 2004, "2016-01-01"),
               player("nf", 2008, "2014-01-01"), player("fall", 2000, "2012-01-01")]
    similar = t.find_similar(players, {"me": me, "twin": twin, "nf": no_future, "fall": faller}, TODAY)
    assert similar["me"][0] == {"id": "twin", "by": "age", "at": 12.0, "match": "path"}
    assert "nf" not in [m["id"] for m in similar["me"]]
    # the different path is only offered as a same-rating fallback, after the real match
    assert [m["match"] for m in similar["me"]] == ["path", "level"]
    assert similar["me"][1]["id"] == "fall"


def test_new_players_get_same_rating_matches_and_inactive_players_get_none():
    newbie = [[1, "2026-03-01", 500]]
    older = history(2010, 11.0, [480, 500, 650, 800, 900, 950, 1000])
    players = [player("new", 2015, "2026-03-01"), player("old", 2010, "2018-01-01")]
    similar = t.find_similar(players, {"new": newbie, "old": older}, TODAY)
    assert similar["new"] == [{"id": "old", "by": "age", "at": 11.25, "match": "level"}]
    assert "old" not in similar  # last played more than two years ago


def test_players_without_birth_year_are_lined_up_by_career():
    a = [[1, "2020-01-01", 500], [2, "2020-07-01", 600], [3, "2021-01-01", 700]]
    b = [[1, "2010-01-01", 510], [2, "2010-07-01", 590], [3, "2011-01-01", 720], [4, "2012-01-01", 900], [5, "2013-01-01", 1000]]
    players = [player("a", None, "2026-01-01"), player("b", None, "2013-01-01")]
    similar = t.find_similar(players, {"a": a, "b": b}, TODAY)
    assert similar["a"] == [{"id": "b", "by": "career", "at": 1.0, "match": "path"}]
