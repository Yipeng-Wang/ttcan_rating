# Scraper speed implementation plan

> Execute inline using superpowers:executing-plans and test-driven-development.

**Goal:** Reduce redundant fetching and parsing without weakening completeness checks.
**Spec:** User-approved improvements in this conversation: persistent validated cache, single history traversal, no cache-hit delay, bounded listing concurrency. Keep eight player workers pending live benchmarking.
**Architecture:** Keep requests and BeautifulSoup. Configure an external cache root in Actions, namespace by source/category/period, validate cached and downloaded pages before use. Fetch listing page one first, then remaining pages with four workers and globally paced request starts. Preserve page order. Extract history rows once per page.
**Constraints:** Python 3.9; no new dependencies; preserve retry count/timeouts, history pagination, player failure threshold and publication checks. Do not alter the active runner or publish changes.
**Review focus:** Invalid cached HTML must be refetched; failed later listing pages must abort; out-of-order responses must not change deduplication order; cache hits must avoid network pacing; repeated history pages must retain existing behavior.

- [x] Add regression tests and observe new cases fail; baseline is 31 passing tests.
- [x] Implement cache-root option/environment, source/category namespace, cache validation and per-thread sessions in backend/scrapping.py. Configure external root in .github/workflows/update-data.yml and document cache behavior in README.md.
- [x] Implement four-worker listing fetch with first-page discovery, ordered assembly and network-only global pacing. Test concurrency using synchronization, not speed thresholds.
- [x] Reuse parsed history rows; compare old/new results over real cached pages and benchmark offline, without contacting TTCAN.
- [x] Run all backend tests, inspect diff, and obtain independent code review. Record actual timing and limitations; leave changes reviewable in the current feature branch.

Ruling: Continue on the existing clean scraper-schedule feature branch; user approved implementation, so no additional worktree or plan approval round is needed.

Verification: 39 backend tests pass (existing LibreSSL/urllib3 warning remains). git diff --check passes. Independent reviewer found no actionable regressions; added the recommended global pacing/retry test. Offline comparison: identical birth years and history for 526 cached players, including all 29 multi-page players; old 3.619s, new 2.991s. Ten cached listing pages: identical output, old 2.333s, new 0.647s. These are local samples, not an end-to-end network speedup claim. No live load benchmark or runner changes; the active retry is left alone. PR preparation: changes moved to scraper-speed, based on scraper-schedule (PR #11), for a separate review of the optimization diff.
