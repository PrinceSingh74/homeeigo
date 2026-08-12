# HOMIGO — Real User Experience Certification

**Date:** 2026-06-23 · **App:** `apps/web` (customer) · **Pipeline:** browser → `/api/vitals` +
`/api/ux-signals` → Prometheus → Grafana. **Runtime evidence only — no fabricated field data.**

---

## ⚠️ Honest status: capture system READY · real-user verdict PENDING real traffic

This mission asked to certify the experience **using production telemetry from real users**. The honest
truth, verified from the live system:

- **There is no production deployment and no real-user traffic.** No production domain is configured;
  the app runs locally (`C:\dev\homigo` / OneDrive).
- The only `web_vitals_*` data in Prometheus (10–27 samples) is from **synthetic headless-Chrome probes**,
  not humans on phones/networks.
- Therefore a real-user PASS/FAIL **cannot be honestly issued** — there is nothing real to certify yet.

**What this certification delivers instead:** the **complete Real-User-Monitoring capture system** —
built, wired, and **verified end-to-end against live Prometheus** — so the verdict is produced
automatically the moment real traffic arrives. Fabricating device/network percentiles would violate
"runtime evidence only," so it is not done here.

---

## What was built + VERIFIED end-to-end (live Prometheus ingestion)

| Capability (mission phase) | Mechanism | Verified |
|----------------------------|-----------|:--------:|
| **Phase 1 — RUM metrics** (route-change, content, interactive, vitals) | `WebVitalsReporter` + `NavigationTracker` beacons | ✅ existing + extended |
| **Phase 2 — Device segmentation** (desktop/android/iphone/ipad/tablet) | `lib/telemetry/context.ts deviceClass()` → bounded label | ✅ `web_vitals_lcp_seconds_bucket{device="iphone",…}` confirmed in `/metrics` |
| **Phase 3 — Network segmentation** (4G/3G/2G/slow-2G) | `networkClass()` via Network Information API → bounded label | ✅ `{…,network="4g",…}` confirmed |
| **Per-route segmentation** | `routeBucket()` (whitelisted) → bounded label | ✅ `{…,route="/services"}` confirmed |
| **Phase 4 — Satisfaction signals** (rapid re-click, back-button, exit-during-loading, nav-success) | `ExperienceSignals.tsx` → `/api/ux-signals` | ✅ `ux_signal_total{signal="rapid_reclick",device="android",network="3g",route="/wallet"}` confirmed |
| **Scroll FPS** | frame sampling during scroll → `ux_scroll_fps` histogram | ✅ ingested |
| **p50/p75/p95/p99** by device & network | Grafana `histogram_quantile` over labeled buckets | ✅ dashboard built |

**Cardinality is bounded server-side** — `/api/vitals` and `/api/ux-signals` whitelist device, network,
route, and signal values, so a spoofed beacon can never explode Prometheus series.

---

## Files changed

| File | Change |
|------|--------|
| `apps/web/src/lib/telemetry/context.ts` *(new)* | bounded device / network / route dimensions |
| `apps/web/src/components/WebVitalsReporter.tsx` | attach `rumContext()` to every vital |
| `apps/web/src/components/NavigationTracker.tsx` | attach `rumContext()` to route-change / page-load |
| `apps/web/src/components/ExperienceSignals.tsx` *(new)* | rapid-reclick / back-button / exit-during-loading / nav-success / scroll-FPS |
| `apps/web/src/app/layout.tsx` | mount `<ExperienceSignals/>` |
| `apps/backend/src/routes/vitals.ts` | accept + whitelist device/network/route labels |
| `apps/backend/src/routes/ux-signals.ts` *(new)* | ingest behavioural signals + scroll FPS |
| `apps/backend/src/index.ts` | register `uxSignalsRoutes` |
| `apps/backend/monitoring/grafana/dashboards/homigo-real-user-experience.json` *(new)* | device/network/route p50–p99 + satisfaction + scroll-FPS + nav-success panels (device/network template vars) |

---

## Phase 5 — Experience Score (formulas; compute from field data)

Each score is 0–100, computed in Grafana/PromQL from the field metrics (p75 unless noted):

```
Navigation     = 60·min(1, 150ms / routeChange_p75) + 40·nav_success_rate
Responsiveness = 70·min(1, 100ms / INP_p75)        + 30·(1 − min(1, rapid_reclick_rate / baseline))
Premium Feel   = 40·min(1, 0.05 / CLS_p75) + 30·min(1, scrollFPS_p25 / 60) + 30·min(1, 2000ms / LCP_p75)
Customer Experience = 0.40·Navigation + 0.30·Responsiveness + 0.30·Premium Feel
```

These resolve to numbers **only when real field data exists**. Today they have no input population.

---

## Reference: synthetic (lab) baseline — NOT a real-user result

For context only (single dev machine, headless Chrome — **not** field data): visual feedback 28ms,
prefetched commit 79ms, content 98–131ms, CLS 0–0.008, TBT 0, scroll TBT 0. These suggest the *technical*
ceiling is in the Uber/Linear class, but **lab numbers are not a Real User Experience certification.**

---

## Verdict

| | Status |
|---|--------|
| RUM capture system (device × network × route × satisfaction × scroll-FPS) | ✅ **built + verified end-to-end** |
| Bounded-cardinality, production-safe ingestion | ✅ |
| Grafana field dashboard + experience-score formulas | ✅ |
| **Real-user PASS/FAIL** | ⏸️ **PENDING** — requires production deployment + real traffic |

### To complete the certification (the only remaining step is real users)
1. Deploy `apps/web` to production (set `NEXT_PUBLIC_API_URL` to the API domain).
2. Let real traffic accumulate (~1–2 weeks for stable p95/p99 per device × network).
3. Read the **Real User Experience** Grafana dashboard; compute the four scores.
4. **PASS** when, on field data: route-change p75 < 150ms, INP p75 < 100ms, CLS p75 < 0.05,
   scroll-FPS p25 ≥ 55, nav-success ≥ 99.5%, and friction signals (rapid re-click / exit-during-loading)
   stay negligible — across desktop, Android, iPhone, tablet and 4G/3G.

**I will not stamp PASS on data that does not exist.** The instrument is built, calibrated, and proven to
record; the readout requires real customers.
