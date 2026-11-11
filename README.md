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

`.github/workflows/update-data.yml` runs daily at 13:00 UTC. It checks the newest rating period on the TTCAN site and stops if that period is already published. When a new period appears, it scrapes players and history, commits the data to `main` and redeploys GitHub Pages. It runs on a self-hosted runner on a home computer, because TTCAN blocks connections from GitHub's servers. The runner is installed in `~/actions-runner-ttcan` as a login service. If the computer is off at 13:00 UTC, the job waits in the queue for up to 24 hours. To check on the runner, run `./svc.sh status` in that folder. To start it by hand, go to the Actions tab, choose **Update ratings data**, then **Run workflow**. Tick "full refresh" to scrape even when the period hasn't changed.

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

## Search engine discovery

The homepage has a descriptive title, description and canonical URL. A static sitemap at `frontend/public/sitemap.xml` is copied to the production build. It lists only the homepage; player, filter and calculator query strings currently share the homepage canonical. Separate indexable pages can be added later if needed.

The app remains client-rendered. Google can render JavaScript; use URL Inspection to check what it actually sees before adding prerendering. Verification is not required to appear in search, but it provides indexing diagnostics and submission tools. Neither verification nor a sitemap guarantees indexing or rankings.

### Google Search Console: HTML-file verification

1. Sign in at [Google Search Console](https://search.google.com/search-console) and add the **URL-prefix** property `https://yipeng-wang.github.io/ttcan_rating/`. DNS verification is unavailable for the GitHub-owned hostname.
2. Choose **HTML file** verification and download the file Google supplies. Put it unchanged, with its original filename, in `frontend/public/`.
3. Commit and deploy the file. The build copies public files to the site. Confirm the file is publicly accessible at the exact URL Google specifies, then click **Verify**. Keep it in future deployments, since Google rechecks ownership. Do not upload it only to the generated build or gh-pages branch: the next deployment replaces those files.
4. Submit `https://yipeng-wang.github.io/ttcan_rating/sitemap.xml` under **Sitemaps**.
5. Use **URL Inspection** on the homepage, run the live test, inspect the rendered page and request indexing. Monitor indexing status and impressions for “TTCAN rankings”, “TTCAN ratings” and “Canadian table tennis rankings”.

Alternatively, add Google's exact HTML verification meta tag to the `<head>` of `frontend/public/index.html` and deploy it. Analytics and Tag Manager verification are available for sites already configured with those services; this project does not need either just for verification. See [Google's verification methods](https://support.google.com/webmasters/answer/9008080).

### Bing and other search engines

Sign in at [Bing Webmaster Tools](https://www.bing.com/webmasters/) and import the verified Google Search Console property. Bing can use that ownership verification without a second verification file. Alternatively, add the site manually and follow Bing's file or meta-tag verification instructions. Submit the same sitemap URL. See [Bing's verification instructions](https://www2.bing.com/webmasters/help/add-and-verify-site-12184f8b).

GitHub project Pages serves this project's robots file under `/ttcan_rating/robots.txt`, but crawlers read robots rules at the host root, `https://yipeng-wang.github.io/robots.txt`. Submit the sitemap directly through the webmaster tools rather than relying on the project-level robots file.

The account owner must obtain the verification file or tag and complete verification. No verification token is included yet, and no indexing request has been submitted.
