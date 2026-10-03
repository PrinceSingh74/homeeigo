# Service domain — certification

Date: 2026-09-20 (final production certification pass). Production migration **not executed**. `BLOCKED` is not converted to `PASS`.

**Verdict: NOT ENTERPRISE RELEASE READY.**

| # | Claim | Result | Evidence |
|---|--------|--------|----------|
| 1 | Existing architecture reused | **PASS** | One `Service` row, one `resolveSelection`, one `bookingPricingService.quote`, one `booking.service`, one `matching.service` + `service-match.ts`. |
| 2 | New domain entities | **PASS** (hybrid) | Lifecycle/version + `service_config_versions` + `service_variants` / `service_addons` / `service_categories`. JSON `catalogConfig` remains the admin write payload. |
| 3 | Database changes | **PASS** (authored) | `20260920120000_service_domain`, `20260920130000_service_variants_addons`. Additive. No `db push` on the cert path. |
| 4 | Migration results | **PASS** (isolated) / **BLOCKED** (production + dev apply) | `homigo_cert_migrate`: 124/124 `migrate deploy`, drift OK (2976 fields, 35 protected objects). Production unauthorized. `homigo_db` missing three 20260920 migrations (not applied). |
| 5 | Service configuration status | **PASS** (engine) | `configStatus`, 25 `configSections`, activation `SERVICE_NOT_BOOKABLE`. |
| 6 | Pricing status | **PASS** | Server `resolveSelection` + exact package tiers. `service-catalog-config.test.ts` 25/0. |
| 7 | Variant / add-on status | **PASS** | Relational hydrate into `resolveSelection`. Inactive/unknown rejected. |
| 8 | Availability status | **PASS** (when configured) | Lead time / same-day / blackout / coverage. Slot trigger ±30m **BLOCKED** on owner D1 (`docs/business-decision-scheduling.md`). |
| 9 | Provider matching status | **PASS** (overlay) | `requiredSkills` + optional weights. `matching.skillWeight` CONFIGURATION_ONLY_BY_DESIGN. |
| 10 | Safety / compliance | **PASS** (config) | Admin-entered only. No invented safety claims. |
| 11 | Admin configuration | **PASS** (code) | 25-section editor. Admin mutation E2E not run this pass. |
| 12 | Customer API | **PASS** | Public projection strips matching weights. Ratings from `ratings` aggregate only. |
| 13 | Partner API | **PASS** | `/me/services` + onboarding now `PARTNER_OPERATIONAL_WHERE` (no INTERNAL/DRAFT). |
| 14 | Mobile / Web parity | **PARTIAL** | Same quote/create APIs. Device **BLOCKED** (`adb devices` empty). |
| 15 | Security | **PASS** (this-pass catalogue leak closed) | Customer cannot set `finalAmount`. INTERNAL hidden from partner/AI/recommendations. Full IDOR suite not re-run this pass. |
| 16 | Concurrency | **PARTIAL** | Quote races 3/3 this pass. Isolated pause∥book / money races not re-run. |
| 17 | Performance | **BLOCKED** (mixed k6) / isolated measured | Isolated heartbeat this pass p50=79 p95=250 p99=375 (120/120). Original mixed 115 VU / ~1720 rps k6 script is not in the repo; aggressive follow-up crashed Bun. Threshold not lowered. Not PASS. |
| 18 | E2E | **BLOCKED** | Not executed this pass. |
| 19 | Schema drift | **PASS** (`homigo_cert_migrate`) / **FAIL** (`homigo_test` vs current models) | Test DB ENVIRONMENTAL (db-push not rebuilt). Dev not drifted-checked after missing migrations. |
| 20 | Payment policy runtime | **PASS** | Quote + wallet/split. Unset = allow. Explicit false rejects. |
| 21 | Quality runtime | **PASS** | Snapshot-backed complete gate. |
| 22 | Warranty | **CONFIGURATION_ONLY_BY_DESIGN** (engine) / **PASS** (window) | Snapshot `{ days, until }`. No revisit domain — `docs/business-decision-warranty.md`. |
| 23 | Analytics | **PASS** (write-path) | view/search/quote counters + booking events. Browse variant_selected CONFIGURATION_ONLY_BY_DESIGN. |
| 24 | Dead configuration | **PASS** | `audit-service-domain-runtime.ts` 0 FAIL. |
| 25 | Duplicate logic | **PASS** | `audit-service-domain-duplicates.ts` PASS. |
| 26 | Fresh migrate rehearsal | **PASS** | `scripts/certify-fresh-migrate.ts`. |
| 27 | Prisma generate (this workstation) | **BLOCKED** | EPERM DLL; `scripts/prisma-generate-windows.ts`. IDE still holds the file after backend restart. |

## This pass implemented (no domain rewrite)

- Shared `CUSTOMER_CATALOG_WHERE` / `PARTNER_OPERATIONAL_WHERE`
- Partner onboarding, `/me/services`, AI context, recommendations, match sibling IDs use those filters
- Snapshot v1/v2 unit test
- Isolated migrate + drift rehearsal
- Generate lock procedure (does not kill Next.js / migrate / this script)

## Intentionally not done

- No second service / pricing / booking / availability / matching / payment engine
- No `prisma db push` on the cert database
- No duration trigger change
- No invented warranty revisit ops
- No production data mutation
- No commit

## Remaining blockers

| Item | Dependency |
|---|---|
| Production migrate | explicit authorization — `docs/service-domain-production-migration-runbook.md` |
| Apply three migrations to `homigo_db` | owner + backup; rename recorded `20260817090000_notification_delivery_claim` → `20260817110000` after verifying PENDING/`updated_at` |
| Rebuild `homigo_test` | harness change to migrate-deploy (ENVIRONMENTAL until then) |
| prisma generate EPERM | stop backend watch / IDE lock; Linux CI generate |
| Mixed-load heartbeat p95 | missing `load.k6.js` harness; isolated p95 250 ms is not that SLO |
| Duration-aware reservation | owner D1 |
| Full E2E / device | CI + physical device or AVD |
| Production PITR | infrastructure restore drill |
