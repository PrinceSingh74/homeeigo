# HOMEEIGO — Enterprise 2035 Dead Code Report

Every item carries the evidence that established it. **Nothing here has been deleted** — this is a removal *plan*, not a removal.

A deliberate note on scale: for a codebase of ~3,200 source files, 218 models and 794 route handlers, the amount of genuine dead code found is **small**. The dominant problem in this repository is not dead code — it is *unwired* code (see `enterprise-2035-unwired-features.md`) and repository-root clutter.

---

## 1. What is NOT dead (checked and cleared)

Recording these prevents a future audit from re-raising them.

| Suspected | Verdict | Evidence |
|---|---|---|
| 6 route files not imported by `index.ts` | **ACTIVE** | `admin-automation`, `admin-intelligence`, `admin-partner-acquisition`, `admin-partner-referral`, `admin-trust-safety` mount via `src/routes/admin.ts:82-86, 2670-2674`; `coverage.ts` mounts via `src/routes/geo.ts:7, 278` |
| `ServiceVariant`, `ServiceAddon` | **ACTIVE** | raw SQL in `src/lib/service-catalog-store.ts:35,74,83,110` |
| `DocumentSequence` | **ACTIVE** | `src/lib/booking-number.ts:26-35` |
| `OpsAlertAcknowledgement` | **ACTIVE** | `src/services/ops-alert-ack.service.ts:21-51` |
| `/api/user/me` (5 apps call it, no `prefix:` match) | **ACTIVE** | declared via `.group("/api/user")` in `src/routes/users.ts:355` |
| `data_quality_results`, `data_versions`, `data_freshness_snapshots` | **ACTIVE** | written by `apps/backend/analytics/` (outside `src/`), max timestamps 2026-09-20 |
| `Math.random()` in backend | **LEGITIMATE** | all 10 uses are retry jitter, lock tokens, nonces or reference IDs — no fabricated business data |

---

## 2. Dead database objects

| Object | Rows | Evidence | Removal |
|---|---|---|---|
| `coupon_segments` | 0 | zero references in `src/`, `analytics/`, `scripts/` | Drop after confirming no planned campaign work |
| `coupon_campaigns` | 0 | same | Drop with the above |
| `coupon_rules` | **1** | same — one stale row | Export the row, then drop |
| `ai_gateway_usage` | 0 | superseded by `AiBudgetPolicy` / `AiBudgetWindow` | Drop |
| `service_categories` | **5** | table exists with data; **no runtime reader**. Category resolution uses `Service.category` + JSONB taxonomy | Confirm taxonomy ownership, then drop or repoint |

> The three `coupon_*` tables are a coherent unfinished feature (segments → campaigns → rules), not incidental cruft. Decide **build or delete** as one decision; leaving them is the worst option because they look like working coupon infrastructure to anyone reading the schema.

**Removal plan:** one migration, hand-scoped. Do **not** use `prisma migrate diff` — project memory records that auto-generated diffs drop booking slot-exclusion columns and 11 indexes.

---

## 3. Dead enum value

`BookingStatus.REJECTED` — **unreachable**.

- Declared and handled in `src/lib/booking-state-machine.ts:45,64,127`.
- **No writer:** every `REJECTED` assignment in `src/` targets a different model (`aiToolApproval`, `providerDocument`, `compliance`, `etaTrainingLabel`). `src/services/provider.service.ts:95` is a read filter only.
- `POST /api/bookings/:id/reject` declines an **offer**, not the booking: `booking.service.ts:1326` requires status `PENDING`, closes the `AssignmentAttempt`, calls `assignmentEngine.onProviderRejected()` and re-dispatches. The booking stays `PENDING`.
- Live DB: **1 row**, created 2026-06-09.

The source comment (*"legacy terminal value; no current writer"*) is accurate.

**Removal:** low priority, non-trivial (enum value removal requires a table rewrite). Migrate the one historical row to `CANCELLED_BY_PROVIDER`, then drop the value — or simply leave it documented. **Recommendation: leave it, keep the comment.** The cost of removal exceeds the benefit.

---

## 4. Dead frontend constants — `apps/web`

`apps/web/src/lib/wallet-dashboard.ts`, `profile-dashboard.ts`, `services.ts` define demo constants behind:

```ts
const MOCK_BUSINESS_DATA_ENABLED =
  process.env.NODE_ENV !== "production" || process.env.NEXT_PUBLIC_ENABLE_MOCK_BUSINESS_DATA === "true";
```

The gate itself is **correct** — these are dev-only and collapse in production builds. But most of the constants have no consumer at all:

| Constant | Consumers | Verdict |
|---|---|---|
| `WALLET_TOTAL_BALANCE` (4250.75) | **0** | DEAD |
| `WALLET_ADDED_THIS_MONTH` (850) | **0** | DEAD |
| `WALLET_H_COINS` (320) | **0** | DEAD |
| `WALLET_GIFT_CARD_VALUE` (850) | **0** | DEAD |
| `WALLET_GIFT_CARD_COUNT` (2) | **0** | DEAD |
| `PROFILE_PREMIUM_FEATURES` | **0** | DEAD |
| `PROFILE_ADDRESSES` | **0** | DEAD |
| `DEMO_PROMO_OFFERS` | **0** | DEAD |
| `DEMO_RECOMMENDED` | **0** | DEAD |
| `WALLET_SPEND_CHANGE_PCT` | 2 | **LIVE — see §5** |
| `WALLET_QUICK_ACTIONS` | 2 | **LIVE — see §5** |

**Why this matters beyond tidiness:** a reader encountering `WALLET_TOTAL_BALANCE = 4250.75` reasonably concludes the wallet is faked. It is not — `WalletBalanceSection.tsx:12,36-37` uses `useWalletBalanceQuery` with the explicit comment *"Backend is the source of truth for the balance — never fall back to a demo value."* The dead constants actively mislead about a surface that is correctly implemented.

**Removal:** delete the 9 unconsumed constants. Zero runtime risk.

---

## 5. Not dead, but broken in production — P2

Two of the gated constants **are** consumed, and in a production build they evaluate to empty:

| Constant | Production value | Consumer | Effect |
|---|---|---|---|
| `WALLET_QUICK_ACTIONS` | `[]` | `WalletQuickActions.tsx:9,29` | The entire quick-actions row (Add Money / UPI / Cards …) **renders empty in production** |
| `WALLET_SPEND_CHANGE_PCT` | `0` | 2 call-sites | Spend-change indicator always reads 0 % in production |

### FE-1 (P2, FRONTEND) — wallet quick actions vanish in production builds

This is a real user-facing regression that no test catches, because tests run with `NODE_ENV !== "production"` where the array is populated. Either make the actions static (they are navigation affordances, not business data, and do not belong behind a mock gate) or drive them from entitlements.

Note also `WalletQuickActions.tsx:42` falls through to `showToast("<label> — coming soon")` for unhandled actions — a no-op handler on a live control.

---

## 6. Repository root pollution — P2, DEVELOPER EXPERIENCE

The repository root holds **60+ historical certification/audit Markdown files** (`HOMEEIGO_*`, `PHASE_*`, `PARTNER_INTELLIGENCE_*`, `ADMIN_HQ_*`, `AI_ASSISTANT_*`, …) alongside **multi-gigabyte log files** committed or left in place:

```
pass7-linux-run1.log        3.4 MB
pass9-linux-run-b.log       6.5 MB
pass13-linux-run-*.log      ~3.4 MB each × 10
... dozens more
```

Git status at audit time: **1,699 changed paths** (1,045 untracked, 594 modified, 60 deleted) on branch `cursor/stage-e-step-13-certification`.

**Impact:** no developer can distinguish current documentation from a superseded certification run. `HOMIGO_V8_FINAL_CERTIFICATION.md`, `HOMEEIGO_WHOLE_PROJECT_FINAL_PRODUCTION_CERTIFICATION.md` and `PHASE_13_FINAL_FORENSIC_RECONCILIATION.md` all claim finality and all disagree.

**Removal plan:**
1. Move every historical report to `docs/archive/<date>/`.
2. Add `*.log`, `pass*.log`, `dist-e2e/`, `dist-s05-cert/`, `.step8-tmp/`, `.sixth/`, `.expo-root-test/`, `scratch-p39/`, `tmp-*` to `.gitignore`.
3. Delete stray artifacts: `Code.exe` (0 bytes), `.taskkill` (0 bytes), `apps/backend/tmp-exec-report.pdf`.
4. Commit the 1,699-path working tree or reset it — an audit cannot distinguish intended change from debris at this volume.

---

## 7. Duplicate / stale build output

| Path | Note |
|---|---|
| `homigo-partner-mobile/homigo-partner-mobile/` | Nested self-duplicate directory |
| `homigo-partner-mobile/dist-e2e/`, `dist-s05-cert/` | Two committed Expo web bundles |
| `homigo-mobile/dist/` | Committed bundle |
| `homigo-mobile/.certification-evidence-old/` | Superseded by `.certification-evidence/` |
| `apps/backend/prisma/generated-client/` | Generated Prisma client checked in |
| `apps/backend/dist/` | Build output |
| `apps/backend/scratch-p39/`, `tmp-pass2-hb/` | Scratch directories |
| `apps/backend/list-admins.cjs`, `list-admins-safe.cjs` | Two variants of one throwaway script |

None affect runtime. All should be ignored or removed.

---

## 8. Frontend utility duplication — NOT a defect

`api-base.ts` exists **once per web app** (`apps/web`, `apps/partner-web`, `apps/admin-panel`). Project memory records this as the deliberate single-source-of-truth-per-app pattern supporting LAN multi-device development (`resolveApiBase` / `resolveWsBase`). There is **no shared `packages/` workspace** — the root `package.json` declares workspaces only for the two mobile apps.

### ARCH-1 (P2, ARCHITECTURE) — no shared package layer

Five client apps each hand-declare backend response types rather than importing them. Project memory already records the consequence: *"a clean `tsc` everywhere is NOT evidence that the wire contract holds."* All six projects typecheck clean, and that guarantees nothing about `null` handling across the wire.

This is the highest-value structural change available and is addressed in the roadmap.

---

## 9. Summary

| Category | Count | Severity |
|---|---|---|
| Orphan tables | 4 (+1 unread) | P3 |
| Unreachable enum value | 1 | P3 — recommend keeping |
| Dead frontend constants | 9 | P3 |
| Constants that break production | 2 | **P2** |
| Root-level historical reports | 60+ | P2 (DX) |
| Stray build/scratch artifacts | ~10 dirs | P3 |
| Dead route files | **0** | — |
| Dead backend services | **0 found** | — |
| `TODO`/`FIXME`/`HACK` in production source | **0** | — |
