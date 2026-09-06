# Admin HQ Quality Failure Matrix

**Date:** 2026-09-06  
**Baseline full suite:** 72 PASS / 16 FAIL / 2 SKIP (51.1 min, webpack dev, sustained load)  
**Navigation performance:** COMPLETE (`3f0f9fa`, `34fc350`, `14fdd9c`)

---

## Summary

| Classification | Count (baseline) | Isolated rerun | Verdict |
|---|---:|---|---|
| ENVIRONMENT (sustained-load / server degradation) | 14 | **14/14 PASS** | Not product defects |
| API (transient 500 under load) | 5* | **5/5 PASS** isolated | Transient; monitor in full rerun |
| A11Y (axe timeout / navigation abort) | 3* | **3/3 PASS** isolated | Cascaded from ENV |
| REAL PRODUCT DEFECT (fixed) | 0 → 2 preventive | — | Page-level `h1` + risk detail shell |

\*Some failures appear in multiple category columns (500 logged during overflow tests).

**Targeted rerun of all 16 failing specs + related files:** **35/36 PASS** (43.7 min). One flaky trust detail timeout after 43 min prior tests — **PASS in 11s isolation**.

---

## Failure inventory (baseline 16)

| # | Test | Route / viewport | Category | Error | Root cause | Fix | Verification |
|---|---|---|---|---|---|---|---|
| 1 | `loop4-admin-responsive-320` | `/vendors` @375px | ENVIRONMENT | `h1 partners@375` not found | Webpack dev degraded after ~40 min; page never committed | Use stable prod server for cert runs; no UI bug | **PASS** isolated (1.0m) |
| 2 | `p0-a11y` dashboard + axe | `/partner-acquisition` | ENVIRONMENT | `ERR_ABORTED` on goto | Navigation aborted mid-suite (server/thread pressure) | Stable runtime | **PASS** isolated (6.9s) |
| 3 | `p0-a11y` modal keyboard | `/partner-acquisition/leads/[id]` | ENVIRONMENT | `ERR_ABORTED` on goto | Same as #2 | Stable runtime | **PASS** isolated (5.2s) |
| 4 | `p1-visual-matrix-remaining` | 768px acquisition | API | Console 500 | Transient backend 500 after long run | Investigate pool; prod server | **PASS** isolated |
| 5 | `p1-visual-matrix-remaining` | 390px acquisition | API | Console 500 | Same | Same | **PASS** isolated |
| 6 | `p1-visual-matrix-remaining` | 375px acquisition | ENVIRONMENT | `h1,h2` not found | Page load timeout under degradation | Stable runtime | **PASS** isolated |
| 7 | `p1-visual-matrix` | 1920px acquisition | ENVIRONMENT | `ERR_ABORTED` goto | Mid-suite abort | Stable runtime | **PASS** isolated |
| 8 | `p1-visual-matrix` | 1366px acquisition | ENVIRONMENT | `h1,h2` not found | Slow/degraded compile | Stable runtime | **PASS** isolated |
| 9 | `p1-visual-matrix` | 1280px acquisition | ENVIRONMENT | `h1,h2` not found | Same | Same | **PASS** isolated |
| 10 | `p1-visual-matrix` | 1024px acquisition | ENVIRONMENT | `h1,h2` not found | Same | Same | **PASS** isolated |
| 11 | `p1-visual-matrix` | 430px acquisition | API | Console 500 | Transient 500 | Prod server | **PASS** isolated |
| 12 | `p1-visual-matrix` | 375px acquisition | API | Console 500 | Transient 500 | Prod server | **PASS** isolated |
| 13 | `section04-finance` axe | `/finance/dashboard` | API | Console 500 | Transient 500 late in suite | Prod server | **PASS** isolated (47.6s) |
| 14 | `section04-finance` responsive | finance routes matrix | ENVIRONMENT | `h1` not found | Degraded server after finance API load | Stable runtime | **PASS** isolated (9.5m) |
| 15 | `section05-trust` responsive | trust routes matrix | ENVIRONMENT | API waitForResponse 45s timeout | Backend slow/unresponsive after 45+ min | Stable runtime | **PASS** isolated (8.6m) |
| 16 | `section09-automation` 12-width | `/automation` | ENVIRONMENT | Automation Center heading not found | Server exhausted at test ~82/90 | Stable runtime | **PASS** isolated (3.2m) |

---

## Preventive fixes applied (quality, not perf)

| File | Change | Why |
|---|---|---|
| `partner-acquisition/*/page.tsx` (7 routes) | `SectionHead as="h1"` | One h1 per page; tests + axe expect page-level heading |
| `trust-safety/risk/[providerId]/page.tsx` | Loading status + explicit risk level span | Shell visible while profile loads; clearer a11y |

**Not committed:** mega-page diffs (`bookings`, `academy`, `services`) — no failing test required them.

---

## Quality closure status

| Gate | Status |
|---|---|
| 16 baseline failures reproduced & classified | ✅ |
| Isolated rerun of failing specs | ✅ 35/36 (1 flaky after 43m sub-run) |
| Production full suite (run 1) | ✅ **87 PASS / 1 FAIL / 2 SKIP** (16.2m) — ai-tools login flake |
| Production full suite (run 2) | ✅ **87 PASS / 1 FAIL / 2 SKIP** (15.5m) — booking availability DATA |
| Fixes applied | ✅ h1 acquisition pages, risk shell, adminLogin in ai-tools, booking slot retry |
| Final certification (run 3) | ✅ **88 PASS / 2 SKIP / 0 FAIL** (11.8m, production `next start`) |

**Quality closure: COMPLETE** (2026-09-06)

---

## Methodology notes

- Invalid to compare collapsed `inert` sidebar clicks vs expanded nav (documented in perf report).
- Full suite must use **production `next start`** or fresh webpack dev with `NODE_OPTIONS=--max-old-space-size=8192` — not a degraded 51-minute Turbopack/webpack session.
- Do **not** claim 88 PASS / 2 SKIP unless a complete stable run proves it.
