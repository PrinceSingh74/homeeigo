# Matching — final certification (2026-09-27, updated 2026-09-29)

## One engine, one order

`matchingService.findBestProviders` / `findBestProvidersWithDiagnostics` is the only matcher. Order (`MATCHING_GATE_ORDER`, hard gates BEFORE scoring, every rejection a reason code):

BOOKING → SERVICE → VERSION → serviceability (coverage) → availability → **PROVENANCE_INVALID** → **BUSINESS_NOT_AUTHORIZED** → **SERVICE_CAPABILITY_MISSING** → **SKILL_MISSING** → **CERTIFICATION_MISSING / _EXPIRED / _UNVERIFIED** → **EQUIPMENT_MISSING** → **INSURANCE_INVALID** → **LANGUAGE_MISMATCH** → **PROVIDER_NOT_AVAILABLE** → **PRESENCE_STALE** → **LOCATION_GATE_FAILED** → **CAPACITY_EXCEEDED** → deterministic order (`compareRankedProviders`: score, fewer unknown signals, id) → offer → accept.

Re-check points using the SAME resolver (`recheckProviderCapability` + `loadServiceGateContextCached`): dispatch offer, accept, direct assign (pre-transaction `precheckOfferCapability`), admin reassign, case same-partner preference. No Mumbai fallback (unknown job location → LOCATION_GATE_FAILED, nothing dispatched); no invented distance/ETA/score/rating (W2-D3 unknown-signal rules intact).

## Evidence

| Claim | Proof |
|---|---|
| Gate order covers every reason and rejects before scoring | `p11-matching-gates.test.ts` 13/13 |
| GF4–GF11, Q17, fixture-row invisibility, offer/accept re-check after expiry/revocation/provenance/compliance, deterministic double run, one capability batch per match (no N+1), duplicate-assignment race → one offer | `p11-matching-gates.integration.test.ts` 25/25 |
| Population disjointness both directions | `w2-d4-fixture-isolation(.integration)`, `matching-population.integration` |
| Unknown signals never fabricated | `w2-d3-unknown-signals(.integration)` |
| Throughput under contention | `release-blocker-elimination` 10/10 (50/100/250/500-way direct-assign creates) after moving the capability recheck before the row lock and before the create transaction (X-7) |
| Measured latency | diagnostics 299 ms @ 56 candidates; 202–215 ms @ 107–164 (homigo_test, local); live read-only diagnostics on a real completed booking: 71.7 ms, mode LEGACY_FALLBACK |
| Reintroduction | gates disabled → 16 fail; population visibility broken → 1 fail (serial proofs in the isolated copy, restored byte-identical) |

## Strict service capability — state and gate

- Flag `matching.strict_service_capability` is **OFF on live** (no row). OFF = LEGACY_FALLBACK: legacy `serviceCategories` rule only for providers with ZERO typed rows; a provider WITH rows needs an ACTIVE one.
- Backfill: `scripts/phase11-capability-backfill.ts` migrates the legacy authority into typed rows (source LEGACY, verifier = the admin actor; skills/certs/equipment/insurance/languages untouched — unknown stays unknown). **Live report: 33 services · 80 dispatchable providers · 688 rows · parity EXACT (0 services would shrink).** The script refuses `--apply` unless post-apply parity is exact.
- Owner sequence to reach STRICT: `bash scripts/owner-run-live-closure.sh` (backup → … → F, verifier after each step), then `bash scripts/owner-run-live-closure.sh g` (flag through `PATCH /api/admin/platform/flags`, audited, **environment `dev`** — the value of `APP_ENV` in `.env`, which is what the backend reads flags under; the admin route's default `production` would write a row nothing reads). Until then: **strict = OWNER_APPROVAL_REQUIRED (gated, rehearsal-proven)**, not CLOSED.
- After STRICT, the legacy String[] is still read by `serviceOfferWhere()` only as the zero-row fallback; a repo search for other legacy capability paths found the dead duplicate (X-3), now deleted, and a second armed writer (X-13, `decideServiceSkill`), now neutralised; both guarded by `x3-capability-single-path.test.ts` (5/5).

## Update 2026-09-28 / 29 — what changed and at which evidence level

| Item | Change | Evidence level |
|---|---|---|
| Capability row provenance (X-12) | a typed row with UNKNOWN provenance now inherits its provider's population; before this, the 50 rows whose origin was never labelled became invisible to real matching the moment provenance was applied | ISOLATED (6 tests, 2 red before); live report: invisible rows 50 → 0 once the live backend restarts on this code |
| Parity (X-18) | `scripts/lib/capability-parity.ts`: today's EFFECTIVE pool vs the strict pool per service, **shrink AND growth must both be 0**; the backfill re-reads parity inside its transaction and throws `PARITY_NOT_EXACT` | ISOLATED (8 tests); REHEARSAL: 688 rows, pool equal to the baseline exactly |
| Read-only strict preview | `GET /api/admin/bookings/:id/matching-diagnostics?mode=STRICT` or `?mode=LEGACY_FALLBACK` runs the same matcher in the named mode without persisting anything (a preview combined with persist/record throws); any other value → 400 `INVALID_MODE` | ISOLATED (`p11-matching-gates.integration.test.ts` 26/26) |
| Verifier F gate | bound to the recorded baseline: counts only rows created after `baseline.recordedAt`, checks source LEGACY / actor / ACTIVE / provenance, compares pools exactly, and fails on duplicates or orphans | REHEARSAL: PASS after F; planted fault → FAIL |
| Verifier G gates | strict flag row must be for the backend's environment, enabled, 100 % rollout, not a kill switch, with a history row and reason, and F must PASS; **strict dry run** compares STRICT vs LEGACY_FALLBACK per candidate on up to 5 upcoming business bookings and **FAILS on zero candidates** (a vacuous comparison is not a pass) | REHEARSAL: per-candidate identical on 3 bookings; LIVE (09-28 15:15): 0 candidates — no partner online — reported as not meaningful, not as a pass |
| Business pool per service (live, read-only) | from the recorded baseline: 2 providers for 25 services, 1 for ac-service / electrician / plumbing / fasade-cleaning / salon-at-home, **0 for spa and personal-hygiene-bathing-care** (see `provider-provenance-closure.md`) | LIVE |

Live today (2026-09-29 00:34 IST, read-only verifier): no flag row, 0 of 688 backfill rows, the runtime gates unreadable because the owner's backend on :3000 is not running. **Strict matching is not live.**
