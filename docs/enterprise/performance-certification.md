# HOMIGO Performance Certification (PHASE 8)

**Date:** 2026-06-18 · **Method:** fresh `next build` (gzipped First Load JS, authoritative) + load-test API latency (Phase 2). Prior "193 kB" report **disregarded per mission rule** and re-measured.

## Frontend bundle — `apps/web` (REAL, fresh build, exit 0)

| Route | Route size | **First Load JS** |
|-------|-----------|-------------------|
| **`/` (homepage)** | 8.81 kB | **312 kB** |
| `/wallet` | 24.5 kB | 332 kB |
| `/book` | 16.6 kB | 329 kB |
| `/bookings` | 25.1 kB | 329 kB |
| `/services` | 23.5 kB | 327 kB |
| `/membership` | 8.99 kB | 258 kB |
| `/legal/*` | 179 B | 226 kB |
| **Shared by all** | — | **224 kB** |
| Middleware | — | 32.8 kB |

## Verdict vs targets

| Target | Measured | Verdict |
|--------|----------|---------|
| **Homepage < 120 kB** | **312 kB** First Load JS | 🔴 **FAIL — 2.6× over** |
| API p95 < 150 ms | **69 ms** isolated (Phase 1/2) | ✅ **PASS** (isolated) |
| API p95 < 150 ms under 100c | 877–981 ms | 🔴 FAIL under load (pool/CPU-bound, Phase 2/4) |
| LCP < 2s, CLS, INP | — | ⚪ **BLOCKED** (needs Lighthouse vs deployed frontend) |

## 🔴 Finding 1 — homepage First Load JS is 2.6× the target
The **224 kB shared baseline** is paid by *every* route — it's the dominant lever. Homepage adds
only 8.81 kB of its own; the weight is the shared chunk. Even the lightest route (`/legal/*`,
179 B) still ships **226 kB**. **Action:** audit the shared chunk for heavy always-loaded deps
(animation/charting/icon libs); move non-critical providers behind dynamic `import()` / route-level
code-splitting. Target: pull the 224 kB shared floor down before the homepage can approach 120 kB.

## 🟢 Finding 2 — API latency is excellent in isolation
69 ms p95 for an authenticated DB-backed read — **well under the 150 ms target**. Under
concurrency it degrades to ~900 ms (pool/CPU ceiling, root-caused in Phase 2, mitigated by
PgBouncer + pool tuning in Phase 4). The *code path* is fast; the *concurrency envelope* is the
constraint.

## ⚪ Finding 3 — Web Vitals not measured (honest BLOCKED)
LCP / CLS / INP require Lighthouse (or web-vitals RUM) against a **served** frontend. Not run this
pass (frontends not deployed in this session). The 312 kB First Load JS is a **risk signal** for
LCP on slow networks but is **not** a measured LCP value — **not claimed**.

## Verdict
**PARTIAL.** API performance **PASS** (isolated). Bundle size **FAIL** vs aggressive 120 kB target
(real 312 kB, root-caused to the 224 kB shared floor). Web Vitals **BLOCKED** on Lighthouse.
Other two frontends built clean (admin .next 24 MB, partner 33 MB static) but route-level First
Load JS not itemized here — same shared-chunk methodology applies.
