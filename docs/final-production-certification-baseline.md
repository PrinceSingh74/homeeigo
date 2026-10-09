# Final production certification — live baseline

Date: 2026-09-20 (this pass). Verified from live code, live Docker Postgres, and commands run in this session. Prior documents were not trusted as evidence.

Production was not touched. No commit.

## Current test result (this pass)

| Suite | Result | Evidence |
|---|---|---|
| `service-domain.test.ts` + `service-runtime-policy.test.ts` + `service-domain-concurrency.test.ts` | **25 pass / 0 fail** | bun test after visibility + snapshot tests |
| `service-catalog-config.test.ts` | **25 pass / 0 fail** | bun test |
| `scripts/audit-service-domain-runtime.ts` | **0 FAIL** | printed LIVE / CONFIGURATION_ONLY_BY_DESIGN table |
| `scripts/audit-service-domain-duplicates.ts` | **PASS** | no client `calculateTotal`, no live-path `rating: 4.8` |
| `scripts/check-migration-safety.ts` | **OK** | 53 scanned files, no protected-object drops |
| `scripts/migration-prereq-audit.ts` | **1 parser hit** | `FK_MISSING_TABLE its` on `20260824130000` — **EXPECTED**: comment text `references its name`, not a real FK. Historical SQL not edited (checksum). |
| Isolated `bun test` full suite ×3 | **not run this pass** | **BLOCKED** — time/harness; last recorded full-suite evidence is prior (see release-certification-status) |

## Current build result

| Step | Result | Evidence |
|---|---|---|
| Backend `npm run dev` | **running** | restarted this pass after generate-lock handling; `http://localhost:3000` |
| Customer web Next.js | **running** (pre-existing) | port 3001 |
| `prisma generate` | **BLOCKED** | EPERM renaming `query_engine-windows.dll.node`. Related bun watch stopped; lock remained (Cursor/IDE). Procedure: `scripts/prisma-generate-windows.ts`. |
| Typecheck after generate | **BLOCKED** | depends on generate |

## Service-domain state (live code)

Single catalogue, single quote (`resolveSelection` → `bookingPricingService.quote`), single booking path, single matcher, single payment path. Hybrid: `Service` + `catalogConfig` JSON + `service_variants` / `service_addons` tables (hydrate overrides JSON).

Runtime consumers (detector + code):

- Payment flags → wallet/split/coupon/membership engines
- Matching weights → `applyMatchingWeights` (unset = historical 30/25/20/15/10)
- `requiredSkills` → hard eligibility before scoring
- Quality → complete-gate from **booking snapshot**
- Warranty days → snapshot `{ days, until }` at complete; **no Warranty model**
- Public projection strips matching weights / internal skills
- This pass: `CUSTOMER_CATALOG_WHERE` / `PARTNER_OPERATIONAL_WHERE` now also filter AI recommendations, AI context, partner onboarding, and match sibling IDs (INTERNAL/DRAFT no longer leak)

## Open blockers

| Item | Class | Owner |
|---|---|---|
| Production `migrate deploy` | BLOCKED | explicit authorization |
| Dev `homigo_db` missing 3 repo migrations | DEFECT (local parity) | DB owner — do not apply without backup + authorization |
| `homigo_test` missing service-domain columns/tables | ENVIRONMENTAL | test harness uses `db push` + SQL replay; not rebuilt this pass |
| Prisma generate DLL lock | BLOCKED | stop leftover Prisma clients; if still locked, IDE restart |
| Heartbeat p95 678 ms > 400 ms | FAIL (prior k6; not re-run to green) | SRE — profile under contention |
| Duration-aware slots | BLOCKED | product D1 |
| Warranty/revisit case engine | CONFIGURATION_ONLY_BY_DESIGN | product — not required in repo |
| Full E2E this pass | BLOCKED | not re-executed |
| Physical device | BLOCKED | `adb devices` empty |
| Production PITR | BLOCKED | production infrastructure |

## Pending migrations vs databases

Repo: **124** migration directories.

| Database | Applied / shape | Classification |
|---|---|---|
| `homigo_cert_migrate` (created this pass) | **124/124** `migrate deploy`, drift **OK** (2976 fields, 35 protected objects) | EXPECTED production shape |
| `homigo_db` (dev) | 125 `_prisma_migrations` rows; **missing** `20260920110000_booking_queue_indexes`, `20260920120000_service_domain`, `20260920130000_service_variants_addons`. Extra recorded name **`20260817090000_notification_delivery_claim`** (no directory in repo). `catalog_config` exists; lifecycle/variant tables **absent**. | DEFECT vs repo (local). Not mutated. |
| `homigo_test` | **no** `_prisma_migrations`; drift **FAIL** vs current Prisma models (service-domain columns/tables missing). Protected objects historically replayed by `test:setup`. | ENVIRONMENTAL (db-push harness) |
| Production | not inspected | BLOCKED — no authorization |

## Runtime consumers (who reads the domain)

Customer web/mobile quote+book APIs; partner `/me/services` + onboarding options; admin 25-section editor; matching; booking complete; wallet/split; analytics counters `service_view_total` / `service_search_total` / `service_quote_generated_total`.

## Unresolved business decisions

Closed 2026-10-10: `docs/phase-1-business-decisions.md` (D1 duration-aware slot, D2 customer_policy default, D3 15-minute EXPIRED, D4 partner supplier / facilitator). GSTIN / TAX_PAYABLE remain a later CA phase.

## Unproven infrastructure / device

Physical device, production backup/PITR, this-pass k6, this-pass Playwright across all panels, Slack/Sentry production delivery.
