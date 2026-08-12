# GitHub Runner — Certification

**Date:** 2026-06-16 · **STATUS: NOT VERIFIED on hosted runner / PASS for all local-equivalent steps.**

## Why hosted-runner verification is impossible in this environment (honest)
- `git remote -v` → **`https://github.com/yourusername/homigo.git`** — a **placeholder**, not a real repository.
- **`gh` CLI is not installed** and there is no GitHub authentication.
- Therefore an actual GitHub Actions run **cannot be triggered or observed here**, and the mission's required outputs — **workflow id, run duration, artifact URLs** — cannot be produced honestly. Per the rules, this is **NOT VERIFIED**, not PASS.

The only honest path to PASS this gate: push this branch to a real GitHub repo with Actions enabled and read back the run. That requires credentials/remote that do not exist in this environment.

## Local context captured
- Commit hash: **`6e8424914de5e2fa1df7542283b930ef6301daa2`**
- Tooling: **bun 1.3.14**, **node v25.9.0** (CI pins **node 20** via `actions/setup-node@v4`; bun via `oven-sh/setup-bun@v2`).

## Workflows audited + enhanced (real improvement)
**`.github/workflows/ci.yml`** — validated as parseable YAML; jobs: **`typecheck`, `build`, `backend-tests`**.
- ADDED this cycle: a **`build`** job that builds all four apps and **uploads `homigo-build-output` artifacts** (backend `dist`, three `.next` dirs, 7-day retention) + **npm dependency caching** (`actions/setup-node` `cache: npm`).
- `backend-tests`: **isolated** `postgres:16` service → `DATABASE_URL=…/homigo_test?connection_limit=5`, `NODE_ENV=test`, `test:setup` + `bun test` (so tests never touch a live DB).

**`.github/workflows/e2e.yml`** — jobs: **`e2e-customer`, `e2e-admin`, `e2e-partner`**, each `npx playwright install --with-deps chromium`, npm cache keyed per app, real `webServer` auto-start.

| Pipeline requirement | Present |
|---|---|
| Backend typecheck / build / tests | ✅ / ✅ / ✅ (isolated PG) |
| Web typecheck / build | ✅ / ✅ |
| Admin typecheck / build | ✅ / ✅ |
| Partner typecheck / build | ✅ / ✅ |
| Playwright customer / partner / admin | ✅ (e2e.yml) |
| Artifacts upload | ✅ (added) |
| Dependency caching | ✅ (added) |
| Node version pinned | ✅ (20) |
| Bun version | setup-bun@v2 (latest; pin optional) |
| Secrets | none required (tests use a service container) |

## Local-equivalent execution (measured green this cycle)
| Step | Result |
|---|---|
| Backend typecheck | **0 errors** |
| Web / Admin / Partner typecheck | **0 / 0 / 0** |
| Backend build (`bun build`) | ✅ 3116 modules, 17.42 MB |
| Web / Admin / Partner build (`next build`) | ✅ / ✅ / ✅ exit 0 |
| Playwright customer / admin / partner journeys | ✅ / ✅ / ✅ (see `customer-playwright-certification.md`) |
| Backend unit tests | run in CI's isolated PG job; **not run locally** (would write to live `homigo_db` — known hazard) |

**STATUS:** **NOT VERIFIED** for the actual hosted GitHub Actions run (no real remote / `gh` / runner in this environment — cannot produce run id / duration / artifact URLs). **PASS** for every reproducible CI step locally (typecheck 0×4, builds 4/4, 3/3 Playwright journeys) and for the audited + enhanced workflow definitions.
