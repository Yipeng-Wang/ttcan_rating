# TTCAN Rating Analysis

Rating distribution, top-100 lists and rating history for Table Tennis Canada (TTCAN) players.

🌐 **Live application**: https://yipeng-wang.github.io/ttcan_rating

## How it works

```
TTCAN rating site ──scrape──▶ frontend/public/data/*.json ──npm run deploy──▶ GitHub Pages
```

1. `backend/scrapping.py` reads the TTCAN rating listing (all players, all activity) and each player's page.
2. It writes static JSON into `frontend/public/data/`:
   - `players.json`: every player in the current rating period, keyed by TTCAN player ID, with their 12-month rating change (`growth`) where it can be compared fairly.
   - `history/<n>.json`: rating history, split into 64 shards by `player ID % 64`.
   - `similar/<n>.json`: for each U13 player, three players of the same gender whose rating grew the same way at the same age (see `backend/trajectories.py`), sharded the same way.
3. The React app loads `players.json` once, and loads one small history shard when you pick a player.
4. The **Rating calculator** page (`?page=calculator`) estimates the points won or lost at a tournament from the opponents' ratings, the results and the event's star level. It follows the points exchange tables and the new-player rules in the [TTCAN Rating System (2016)](http://96.31.42.60/upload/TTCANRatingSystem2016.pdf), implemented in `frontend/src/rating.js`.

No API keys or Google services are involved. The data files are committed, so the repo always holds the last published data.

## Updating the data

```bash
cd backend
python3 -m venv venv && source venv/bin/activate
pip install -r requirements.txt

python scrapping.py --history     # players + rating history (full refresh)
python scrapping.py               # players only; existing history files are kept
```

Then deploy the site (see below) and commit the changed files in `frontend/public/data/`.

### Automatic updates

`.github/workflows/update-data.yml` runs twice a day, at 13:17 and 21:17 UTC. It checks the newest rating period on the TTCAN site and stops if that period is already published. When a new period appears, it scrapes players and history, commits the data to `main` and redeploys GitHub Pages. It runs on a self-hosted runner on a home computer, because TTCAN blocks connections from GitHub's servers. The runner is installed in `~/actions-runner-ttcan` as a login service. If the computer is off at 13:00 UTC, the job waits in the queue for up to 24 hours. To check on the runner, run `./svc.sh status` in that folder. To start it by hand, go to the Actions tab, choose **Update ratings data**, then **Run workflow**. Tick "full refresh" to scrape even when the period hasn't changed.

Options:

| Flag | Meaning |
|---|---|
| `--history` | Also scrape each player's rating history |
| `--period N` | Rating period ID. Default: the newest period on the TTCAN site |
| `--max-pages N` | Only scrape the first N listing pages (for testing) |
| `--fresh` | Ignore cached pages for this period |
| `--force` | Publish even if the player count dropped by more than 10% |
| `--out DIR` | Output directory (default `frontend/public/data`) |
| `--rebuild-derived` | Only recompute 12-month growth and `similar/` from the published data, without scraping |

Safety and resuming:

- Every fetched page is cached in `backend/.cache/<period>/`. If a run is interrupted, run the same command again and it continues from the cache.
- A failed or malformed page stops the run with an error. Partial data is never published.
- New data is written to a staging folder and swapped in only after it passes checks. It is refused if the player count drops by more than 10% from the last run.

## Frontend

```bash
cd frontend
npm install
npm start          # http://localhost:3000/ttcan_rating
npm test
npm run deploy     # build and publish to the gh-pages branch
```

Pushing frontend changes to `main` deploys the site automatically through `.github/workflows/deploy-site.yml`.

## Tests

```bash
cd backend && python -m pytest tests      # parser and publishing tests, using saved TTCAN pages
cd frontend && CI=true npm test
```

## Source

TTCAN ratings are published at http://96.31.42.60/rating.aspx. The scraper reads the listing at
`/ratingSystem/ctta_ratings3.asp` and player pages at `/ratingSystem/ctta_ratings1.asp`.
Set `TTCAN_BASE_URL` in a `.env` file if the address changes again (see `.env.example`).

## License

This project is for educational and analysis purposes only.
