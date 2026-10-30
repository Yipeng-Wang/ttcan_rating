import trajectories as t


def history(birth_year, start_age, ratings, step_months=6):
    """Ratings every `step_months` starting at `start_age` -> [[period, iso date, rating], ...]."""
    out = []
    for i, rating in enumerate(ratings):
        months = round(start_age * 12) + i * step_months
        year, month = birth_year + months // 12, months % 12 + 1
        out.append([i, f"{year}-{month:02d}-01", rating])
    return out


def player(pid, birth_year, gender="M"):
    return {"id": pid, "birthYear": birth_year, "gender": gender}


def ids(matches):
    return [(m["id"], m["match"]) for m in matches]


def test_resample_interpolates_and_skips_long_breaks():
    grid = t.resample([(10.0, 1000), (10.5, 1100), (13.0, 1500)])
    assert grid[40] == 1000 and grid[41] == 1050 and grid[42] == 1100
    assert 44 not in grid  # 2.5-year break is not filled in
    assert grid[52] == 1500


def test_tiers_fill_three_matches_best_first():
    me = history(2014, 10.0, [800, 900, 1000, 1100, 1200])                                   # age 10 to 12
    twin = history(2004, 10.0, [790, 905, 990, 1110, 1190, 1300, 1450, 1500, 1600])          # same climb
    level = history(2000, 10.0, [1300, 1250, 1200, 1200, 1210, 1250, 1300, 1300, 1350])     # same rating, other path
    near = history(2001, 10.0, [500, 600, 700, 800, 900, 1000, 1100, 1200, 1300])           # 300 lower at 12
    short_future = history(2008, 10.0, [800, 900, 1000, 1100, 1200, 1210])                   # half a year later only
    players = [player(p, by) for p, by in [("me", 2014), ("twin", 2004), ("level", 2000), ("near", 2001), ("sf", 2008)]]
    similar = t.find_similar(players, {"me": me, "twin": twin, "level": level, "near": near, "sf": short_future})
    assert ids(similar["me"]) == [("twin", "path"), ("level", "level"), ("near", "near")]
    assert similar["me"][0] == {"id": "twin", "by": "age", "at": 12.0, "rating": 1190, "match": "path"}


def test_only_same_gender_unless_the_player_has_none():
    me = history(2014, 10.0, [800, 900, 1000, 1100, 1200])
    girl = history(2004, 10.0, [790, 905, 990, 1110, 1190, 1300, 1450, 1500, 1600])
    boy = history(2005, 10.0, [800, 900, 1000, 1100, 1200, 1300, 1400, 1500, 1600])
    data = {"me": me, "girl": girl, "boy": boy}
    as_girl = t.find_similar([player("me", 2014, "F"), player("girl", 2004, "F"), player("boy", 2005, "M")], data)
    # the girl is the real match; the boy only fills the last slot as a last resort
    assert ids(as_girl["me"]) == [("girl", "path"), ("boy", "near")]
    unknown = t.find_similar([player("me", 2014, ""), player("girl", 2004, "F"), player("boy", 2005, "M")], data)
    assert sorted(m["id"] for m in unknown["me"]) == ["boy", "girl"]


def test_widens_to_nearby_ages_and_shares_the_matched_age():
    me = history(2014, 11.0, [700, 800, 900])                 # latest at 12.0
    older = history(2000, 12.75, [900, 1000, 1100, 1200])      # starts three quarters later
    similar = t.find_similar([player("me", 2014), player("older", 2000)], {"me": me, "older": older})
    assert similar["me"] == [{"id": "older", "by": "age", "at": 12.75, "rating": 900, "match": "near"}]


def test_inactive_and_single_rating_players_still_get_matches():
    newbie = [[1, "2026-03-01", 500]]
    old = [[1, "2005-01-01", 600]]
    older = history(2010, 11.0, [480, 500, 650, 800, 900, 950, 1000])
    players = [player("new", 2015), player("old", 1994), player("older", 2010)]
    similar = t.find_similar(players, {"new": newbie, "old": old, "older": older})
    assert similar["new"][0] == {"id": "older", "by": "age", "at": 11.25, "rating": 490, "match": "level"}
    assert similar["old"][0] == {"id": "older", "by": "age", "at": 11.0, "rating": 480, "match": "near"}  # inactive since 2005


def test_every_player_gets_three_matches_when_three_others_exist():
    oldest = [[1, "2023-01-05", 1000]]  # age 94, nobody else near that age
    kids = {f"k{i}": history(2000 + i, 10.0, [600 + i * 10, 700, 800]) for i in range(4)}
    players = [player("oldest", 1929)] + [player(k, 2000 + i, "F") for i, k in enumerate(kids)]
    similar = t.find_similar(players, {"oldest": oldest, **kids})
    assert len(similar["oldest"]) == 3
    assert all(len(similar[k]) == 3 for k in kids)


def test_players_without_birth_year_are_lined_up_by_career():
    a = [[1, "2020-01-01", 500], [2, "2020-07-01", 600], [3, "2021-01-01", 700]]
    b = [[1, "2010-01-01", 510], [2, "2010-07-01", 590], [3, "2011-01-01", 720], [4, "2012-01-01", 900], [5, "2013-01-01", 1000]]
    similar = t.find_similar([player("a", None), player("b", None)], {"a": a, "b": b})
    assert similar["a"] == [{"id": "b", "by": "career", "at": 1.0, "rating": 720, "match": "path"}]
