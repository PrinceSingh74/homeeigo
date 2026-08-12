# CI Runner Certification

**Workflow files:** `.github/workflows/ci.yml`, `.github/workflows/e2e.yml`  
**Timestamp:** 2026-06-14T21:05:00Z – 2026-06-14T21:08:01Z

## GitHub Actions

| Check | Result | Evidence |
|-------|--------|----------|
| `gh run list` on remote | **NOT RUN** — `gh` CLI not installed in environment | shell exit 127 |

CI green status on GitHub Actions **not verified** in this session.

---

## Local CI Equivalence

### Builds

| App | Command | Timestamp | Result | Evidence |
|-----|---------|-----------|--------|----------|
| Backend bundle | `bun run build` | 2026-06-14T21:07:28Z | **PASS** | `backend-build-signoff.log` |
| Customer web | `npm run build` | 2026-06-14T21:00:35Z | **PASS** | `web-build-signoff.log` |
| Admin panel | `npm run build` | 2026-06-14T21:00:35Z | **PASS** (4 ESLint warnings) | `admin-build-signoff.log` |
| Partner web | `npm run build` | 2026-06-14T21:08:01Z | **FAIL** — `PageNotFoundError: /earnings` | `partner-build-signoff.log` |

### Typecheck (`ci.yml` job: typecheck)

| App | Timestamp | Result | Evidence |
|-----|-----------|--------|----------|
| Backend `tsc --noEmit` | 2026-06-14T21:05:44Z | **FAIL** — 15+ TS errors (pre-existing) | `ci-backend-typecheck.log` |
| Web | Not re-run | Prior session **PASS** | `measurements/web-build.log` |
| Admin | Build-time tsc | **PASS** | `admin-build-signoff.log` |
| Partner | Not run (build failed) | **FAIL** | `partner-build-signoff.log` |

### Tests (`ci.yml` job: backend-tests)

| Check | Result | Notes |
|-------|--------|-------|
| `NODE_ENV=test bun test` | **NOT RUN** | Requires Postgres on `:5433` per workflow |

### Artifacts / E2E (`e2e.yml`)

| Check | Result |
|-------|--------|
| Playwright CI workflow | **NOT TRIGGERED** |

---

## CI Certification Verdict

| Requirement | Result |
|-------------|--------|
| Backend build | **PASS** |
| Web build | **PASS** |
| Admin build | **PASS** |
| Partner build | **FAIL** |
| Backend typecheck | **FAIL** |
| Tests | **NOT VERIFIED** |
| GitHub Actions green | **NOT VERIFIED** |

**Overall CI: FAIL** (partner build + backend typecheck blockers; remote runner not executed).
