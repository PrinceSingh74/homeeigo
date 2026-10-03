# Service domain — final operational report

This pass turns stored service configuration into execution inside the **existing** engines. No second pricing, matching, booking, or payment engine was added. Production migrate was not run. No commit.

## 1. Current architecture

```
SERVICE DOMAIN (Service + catalogConfig + variants/addons tables)
        │
 CUSTOMER / PARTNER / ADMIN  →  BACKEND
        │
 QUOTE → AVAILABILITY → ELIGIBILITY → BOOKING → PAYMENT → DISPATCH → EXECUTION → QUALITY → COMPLETION → REVIEW
```

Backend remains authoritative for price, bookability, eligibility, payment policy, and completion gates. Historical bookings bind to `serviceConfigSnapshot`.

## 2. Old logic replaced / adapterized

- Partner onboarding 7-item list → `GET /api/partner/register/service-options` from live catalog, fallback `partnerOnboardingOptionDefs()` (the old slug map) only when the catalog is empty.
- Matching still uses `service-match.ts` category/slug map **plus** `providerRequirements.requiredSkills`.
- Mobile no longer silently uses shared `ADDONS` when a service has no catalog add-ons.
- Matching score stays the existing 30/25/20/15/10 components; configured weights rebalance those components instead of inventing a new algorithm.

## 3. New runtime consumers

| Config | Consumer |
|---|---|
| payment.wallet/split | `wallet-checkout.service` |
| payment.coupon/membership | `booking-pricing.service` |
| matching weights | `matching.service.scoreProvider` |
| quality proof/checklist | `booking.service.complete` (before earnings txn) |
| requiredSkills | matching `loadCandidates` + booking-validation |
| materials/equipment | public `byId` + partner `execution` + `/me/services` |
| capability profile | `bookingFlowForProfile` on public detail |

## 4. DB changes

None in this pass. Snapshot JSON now includes `payment`, `quality`, `matchingWeights`. Additive Service / version tables from earlier migrations are unchanged. `prisma db push` was not used.

## 5. Migration results

- Production migrate: **BLOCKED** (unauthorized).
- `prisma generate` on Windows may still EPERM if the query engine DLL is locked.
- Isolated migrate / schema-drift: **BLOCKED** until generate + test DB are free.

## 6. Service configuration coverage

See `docs/service-domain-runtime-matrix.md`. Every important field is LIVE, PARTIAL, or CONFIGURATION_ONLY_BY_DESIGN.

## 7–11. Surfaces

- **Customer web**: already sent variantId/quantity/audience to quote+create.
- **Customer mobile**: catalogConfig variants/audiences/quantity; selection carries `variantId`/`audience`/`quantity`; no hardcoded add-on fallback; unavailable variant copy is explicit.
- **Partner web**: onboarding fetches catalog options; `GET /api/providers/me/services` is rendered at `/work-hq/services`.
- **Partner mobile**: onboarding fetches the same options; complete sends photos **before** the completion call so proof gates can pass.
- **Admin**: payment/quality/matching controls show runtime consumers (Payment engine, Completion gate, Matching engine).

## 12. Provider eligibility

OLD MAP + `requiredSkills` overlay. A provider missing required skills is not a candidate and cannot be booked as a selected provider.

## 13. Matching

`configuredMatchingWeights` null → historical additive formula. Configured weights → `applyMatchingWeights` then premium/career boosts. `matchingConfigVersion` is the service version on the in-memory match (score table has no version column; persistence of version is PARTIAL).

## 14. Availability

Lead time, same-day, blackout, coverage already execute in `booking-validation.service` when configured. Unset rules stay optional.

## 15. Booking

`bookingConfigSnapshot` now stores payment, quality, materials, equipment, matching weights. Future admin edits do not rewrite historical jobs.

## 16. Payment

Explicit `false` rejects wallet/split/coupon/membership. Unset keeps previous allow behaviour (no silent financial policy change).

## 17. Quality

Snapshot-backed. Old bookings without quality do not gain new gates. `customerConfirmation` is CONFIGURATION_ONLY_BY_DESIGN (Rating). Warranty days are snapshotted; revisit case engine is PARTIAL (no Warranty model).

## 18. Analytics

Counters: `service_payment_policy_rejected_total`, `service_quality_completion_block_total`, `service_provider_ineligible_total`. Conversion/revenue remain derived, not editable SKU fields.

## 19. Security

Public catalog still strips matching weights and internal provider requirement lists. Payment and quality are enforced server-side. Clients cannot activate services.

## 20. Concurrency

Existing `service-domain-concurrency.test.ts` remains. Quality gate runs before the money transaction so a racy complete without proof cannot post earnings.

## 21. Performance

No extra matching algorithm. Catalog onboarding options is one `findMany` of active services (cap 200). Matching may load catalog twice (candidates + weights) — correctness over a micro-cache.

## 22. E2E

Not re-run this pass (no local browser/device claim). Customer mobile booking unit tests cover selection keys. Partner `/me/services` page is a real GET of the existing endpoint.

## 23. Dead configuration audit

`apps/backend/scripts/audit-service-domain-runtime.ts` fails if a listed LIVE field has no consumer string in source.

## 24. Remaining blockers

| Item | Status | Dependency |
|---|---|---|
| Production migrate | BLOCKED | explicit authorization |
| prisma generate EPERM | BLOCKED | unlock query_engine-windows.dll.node |
| Isolated migrate / schema-drift / perf p95 | BLOCKED | generate + test DB |
| Duration-aware provider slot | CONFIGURATION_ONLY_BY_DESIGN | owner decision to change protected trigger |
| Warranty revisit ops flow | PARTIAL | no Warranty model; do not invent |
| invoiceRequired / paymentTiming | CONFIGURATION_ONLY_BY_DESIGN | no matching engine path |
| matchingConfigVersion on ProviderMatchScore | PARTIAL | would need additive column |
| Physical device E2E | BLOCKED | device |
| Full panel typecheck/E2E/perf suite | not claimed | run in CI |

Never claim a field is runtime-active without the consumer named above.
