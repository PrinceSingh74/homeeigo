# HOMEEIGO Mobile — Performance Certification (Phase 2)

**Date:** 2026-07-30 · **Verdict:** ✅ **PASS**, with the scope of what was proven stated precisely below.
**Device:** Realme RMX3943, Android 15, USB · **Build:** development build over Metro
Companion: `PERFORMANCE_REPORT.md` · Harness: `homigo-mobile/scripts/perf-measure.sh`

---

## 1. What was proven, and how

| Claim | Verdict | Method |
|---|---|---|
| Background polling of `/api/users/bookings` stops when the app is backgrounded | ✅ **Proven** | Focus-gated measurement: **+8** requests / 40 s foreground, **+0** / 45 s verified-backgrounded, **+8** / 40 s foreground again |
| Polling resumes on return to foreground | ✅ **Proven** | Third window above |
| Retrying settled 4xx was costing 4× the requests | ❌ **Disproven by measurement** | Requests per 404 miss: **2.31 before**, **2.17 after** — inside noise. No performance benefit claimed. |
| Mutations no longer replay a settled 4xx | ✅ **Code-verified** | Removes a duplicate-booking / duplicate-payment path. Correctness, not speed. |
| Frame or memory improvement from this phase | ⚠️ **Not claimed** | The two captures are not comparable (cold-start process vs long-lived one). See report §4. |

---

## 2. Quality gates

| Gate | Result | Evidence |
|---|---|---|
| No backend changes | ✅ | nothing outside `homigo-mobile/` touched |
| No API changes | ✅ | no file under `src/services/` modified |
| No database changes | ✅ | client only |
| No authentication regressions | ✅ | logged in successfully during testing (`auth/login → 200`); `auth-store` / `AuthProvider` / `AuthGuard` untouched |
| No booking regressions | ✅ | **Booking created end-to-end on device after the changes** — `POST /api/bookings → 201`, row `HOMIGO-20260730-00001`, scheduled `2026-08-01 07:30 UTC`, and it renders in the Bookings list as *01 Aug · 1:00 pm · ₹219 · Upcoming* |
| No payment regressions | ✅ | **Paid end-to-end on device** — `create-order → 200`, `verify → 200`, payment row `SUCCESS · ₹219 / ₹219 · pay_TJew5IR4TNvxAe`, and **ledger drift 0** across 1,165 entries |
| No notification regressions | ✅ | notification code untouched |
| No routing regressions | ✅ | `app/` tree unchanged in this phase |
| No TypeScript errors | ✅ | `tsc --noEmit` → **0** |
| No runtime crashes | ✅ | app cold-started, navigated, logged in and scrolled repeatedly on device with no crash |
| Diagnostics removed | ✅ | temporary `[PERF]` logs deleted; `grep -c PERF` → **0** |
| Build | ✅ | `expo export --platform android` exit 0, Hermes bundle **9.03 MB** |

---

## 3. Changes in this phase

| # | Change | File | Justification |
|---|---|---|---|
| 1 | `focusManager` bridged to `AppState` | `src/lib/connectivity/connectivity-service.ts` | **Measured**: eliminates all polling while backgrounded |
| 2 | Status-aware retry policy on the `QueryClient` | `src/providers/QueryProvider.tsx` | **Correctness**: a settled 4xx cannot succeed on retry. No perf benefit measured. |
| 3 | Mutations refuse to replay a settled 4xx | `src/providers/QueryProvider.tsx` | **Safety**: prevents a retried `POST` duplicating a booking or payment |
| 4 | Removed four local `retry:` overrides | `use-active-tracking.ts`, `use-core-data.ts` ×2, `use-live-tracking-view.ts` | Consistency — they bypassed the client policy |
| 5 | Added `scripts/perf-measure.sh` | new | Makes every future measurement repeatable and diffable |

Nothing was optimised speculatively. Short lists, query defaults, the realtime channel and the
persisted store were audited, found healthy, and deliberately left alone.

---

## 4. Honest limits of this certification

- **Development build.** All device numbers come from a Metro-served dev build. Release performance
  will differ, likely substantially. No release measurement was taken.
- **A single device.** One Realme RMX3943. No tablet, no low-end device, no iOS.
- **Frames and memory have a baseline, not a comparison.** 56.04 % janky frames, p50 27 ms and 807 MB
  PSS are recorded as a standalone baseline for future work — not as a result of this phase.

## 5. Money-path verification (closes both ⚠️ gates)

Run on device after all Phase 2 changes, with pre-state captured first.

| | Before | After |
|---|---:|---:|
| Bookings | 275 | **276** |
| Payments | 181 | **182** |
| Payments `SUCCESS` | 130 | **131** |
| **Ledger drift** | **0** | **0** |
| Ledger entries | 1,163 | 1,165 |

Request sequence observed in the Metro log: `POST /api/bookings → 201` → `POST /api/payments/create-order → 200`
→ `POST /api/payments/verify → 200`. Exactly **one** booking and **one** payment row were created — the
stricter mutation-retry policy produced no duplicates. The resulting row reads
`HOMIGO-20260730-00001 · SUCCESS · ₹219 / ₹219 · pay_TJew5IR4TNvxAe`, and the Bookings list renders it as
*01 Aug · 1:00 pm · ₹219 · Upcoming*, matching the stored `2026-08-01 07:30 UTC` exactly.

## 6. Recommended next actions

1. Take a release-build measurement with the same harness to learn the real frame profile — the 56 % jank
   figure is from a dev build and is not a release verdict.
2. Investigate the 56 % jank itself once a release baseline exists.
3. Convert the remaining 2,669 KB of PNGs to WebP.
