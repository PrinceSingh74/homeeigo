# Phase 06 — Remaining-closure report (2026-09-22)

Every figure comes from a command run in this session. Raw output: `docs/operations/evidence/phase-06-closure-*` and `phase-06-content-v2-*`. The design for what stays open is in `phase-06-commercial-and-safety-closure-design.md`.

## 1. Commercial architecture

**Audit result.** No customer-facing *inspection → itemised quote → approval → payment* mechanism exists. Two facts block it, and neither can be supplied by code:

1. **No authoritative amount.** There is no parts, gas or paint price list. A partner-typed amount is not server-authoritative.
2. **No money path beyond the one booking payment.**
   - `payments.booking_id` is **UNIQUE**: one payment and one gateway order per booking.
   - Tips are wallet-only and customer-initiated.
   - `FinancialAdjustment` is admin maker-checker, wallet-only, with no customer approval and no booking-item link.

An additional charge needs its own ledger-linked record, gateway order and refund semantics. That is Phase 09 scope.

**What was built instead:** a complete, reusable design, ready to implement. It covers:
- tables, the state machine and money rules that reuse Phase 05 (paise, central rounding, `TAX_POLICY`, the signed-token pattern)
- the C1–C10 test plan
- the 5 owner decisions that unblock it: price authority, pay timing, declined-quote policy, refund policy, invoice presentation

Nothing was implemented, because building it would mean inventing the amount authority and the refund policy.

## 2. The four services' commercial status

**home-painting, ac-service, electrician, plumbing: COMMERCIAL_HOLD (unchanged, correct).**

- Their `SEPARATE_QUOTE` lines tell the customer honestly that paint, gas and parts are not included and are confirmed with them before use. No amount is stated.
- The hold is enforced structurally. The engine refuses `SEPARATE_QUOTE` outside COMMERCIAL_HOLD and refuses any `CHARGEABLE` line without an add-on (R12).
- **Closes when:** the Phase 09 primitive exists and passes C1–C10 plus browser verification.

## 3. Safety status

**fasade-cleaning: SAFETY_HOLD (unchanged, correct). One live defect found and fixed.**

- **Audit:**
  - no work-at-height, scaffolding, harness, rope-access or PPE model anywhere
  - 5 providers carry the facade category; 0 hold any certification
  - no site-assessment-before-booking flow
- **Defect (live since v1):** the customer saw *"We bring: Access equipment, confirmed after assessment · Included in the price"*. That is an equipment and price promise nothing defines.
  - **Fix:** the line was removed. Facade equipment is now `NOT_CONFIGURED`, declared with a reason under SAFETY_HOLD; the readiness report shows `SAFETY_HOLD`. The unused catalogue item was archived after nothing used it.
  - The customer now sees only: society permission; *Safe access checked before work starts*, with the detail that unreachable areas are not covered; water, power, an adult; and "We bring: Cleaning products".
- **Window-cleaning:** unchanged. Interior-reachable glass only; the rest is assessed on arrival (READY_WITH_INSPECTION).
- **Future model** (site assessment, access method, allowed scope, provider capability with evidence, equipment, safety approval, execution eligibility): specified in the design doc and left unpopulated.

## 4. A1 / A2 / A3 provenance

These are ordinary content decisions (who supplies household supplies, repotting mix and packing consumables). They carry no price, safety, legal or medical claim, so they fall within the owner's Phase 06 authorisation to finalise ordinary content.

- **Promoted:** `SYSTEM_INFERRED → OWNER_APPROVED` on all 8 lines (A1 ×6, A2 ×1, A3 ×1).
- **Audit trail:** the internal note says *"Promoted under owner's Phase 06 content authorization (2026-09-22)."* The assumption ids are kept for traceability.
- **Guards:** `ASSUMPTION_PROVENANCE_OVERWRITTEN`, `PROMOTION_WITHOUT_TRACE`, `PROMOTION_WITHOUT_ASSUMPTION`.
- **Still overridable** in admin tab 09b. The apply script refuses to overwrite any admin edit.

## 5. Changes made

| Area | Change |
|---|---|
| Content v2 (`phase-06-requirement-content-final.ts`) | Facade equipment promise removed (`unconfigured` under SAFETY_HOLD). A1–A3 promoted. Two duplicated label/note pairs fixed: the facade safe-access label, and the packing-material note. Note version tags are per line, so unchanged lines never churn a service version. |
| Frozen v1 | `phase-06-requirement-content-final.v1.json` (hash `c19f8ab1…`) and `phase-06-requirement-content-final.v1.md` (sha256 `bdaa3511…`), immutable. |
| Engine | New rules: `UNSUPPORTED_EQUIPMENT_PROMISE`, `METHOD_CLAIM_UNSUPPORTED`, `SAFETY_COPY_MUST_STATE_ASSESSMENT`, `UNCONFIGURED_OUTSIDE_SAFETY_HOLD`, `UNCONFIGURED_CONTRADICTS_ASSIGNMENT`, `UNCONFIGURED_AND_NO_SPECIAL`, `ASSUMPTION_PROVENANCE_OVERWRITTEN`, `PROMOTION_WITHOUT_TRACE`, `PROMOTION_WITHOUT_ASSUMPTION`, `COPY_DUPLICATES_LABEL`. |
| Apply | `--supersedes <frozen artifact>`: a service or catalogue item is replaced only if it still equals the previous artifact; anything else counts as an owner edit and is refused. Retired items are archived once unused. `planService` returns `SUPERSEDE`. |
| Readiness report | Distinguishes `SAFETY_HOLD` from `OWNER_INPUT_REQUIRED` and `NO_SPECIAL_REQUIREMENTS`. |
| Docs | This report; the commercial and safety design; `phase-06-requirement-content-final.md` re-rendered (hash `e5de61b9…`). |

No schema change and no migration.

## 6. Tests

- **Phase 06 suites:** 69 pass / 0 fail (content engine 35, unit 20, integration 14).
- **Reintroductions:** S1–S4 and A1–A3, 7/7 caught, each GOOD 68/0 → DEFECT → byte-identical restore → 68/0.
  - S1: safety-hold bypass
  - S2: unsupported equipment claim
  - S3: method claim in partner copy
  - S4: safety copy stops stating the assessment
  - A1: provenance relabelled
  - A2: promotion trace stripped
  - A3: engine rule removed
- **C1–C10:** not applicable. No commercial implementation exists to break; the design specifies them for Phase 09.
- **Versions and snapshots** (on a restored copy of live): Version A bookings on dusting-wiping and fasade-cleaning, then v2 applied (v3 → v4). Both booking snapshots stayed **byte-identical**; the fasade booking keeps what it was told at the time.
- **Owner-edit guard:** an admin-edited plant-care was refused, and superseded only after it matched v1 again. The third run was fully idempotent.

## 7. Browser evidence

Isolated stack on a restored copy of live with v2 applied: **7/7**.
- Facade is v4, with no "access equipment" and no method or certification claim.
- It states permission, the assessment and that unreachable areas are excluded; the only "We'll bring" line is cleaning products.
- dusting-wiping copy is unchanged by the promotion.
- window-cleaning interior-only scope is preserved.
- No provenance text on any page or response.

## 8. Financial regression

- **Full backend suite:** **3006 pass / 0 fail** across 250 files.
- **Live `homigo_db` before and after the v2 apply:** bookings, payments, refunds, ledger, 707 booking snapshots, slot windows and 35 fixture services are **byte-identical**.
- **Phase 05 is untouched:** no pricing, quote, payment or refund code changed.

## 9. Security

- Provenance and internal notes never reach customer or partner projections (engine rules, content tests, and a live check on :3000).
- No secrets in any evidence file.
- The live write is bound to `--expect-hash` and a verified SUPER_ADMIN actor.

## 10. Migration

None needed; the content lives in the existing Phase 06 tables. Schema drift is OK after the apply.

## 11. Live application

1. **Backup:** `homigo_2026-09-22T14-54-12-372Z.dump`, sha256 `440f41fd…`, uploaded to S3. The restore drill passed (707 bookings).
2. **Dry-run:** identical to the rehearsal of the exact artifact.
3. **Apply:** `--expect-hash e5de61b9… --supersedes v1`.
   - 7 services superseded (v3 → v4): dusting-wiping, sweeping-mopping, utensil-washing, packing-unpacking, hourly-bookings, plant-care, fasade-cleaning.
   - 1 catalogue label updated (`safe-access-assessed-on-site`).
   - 1 item archived (`access-equipment-assessed-on-site`).
   - 24 services identical; 0 refused; 0 failed.
   - Audit: 7 `SERVICE_CONFIG_VERSIONED` and 2 catalogue-item entries.
4. **After:** a re-run changes nothing; readiness shows 0 invalid; the live backend serves v4 with no leaks.

## 12. Remaining external / business decisions

| Item | Owner | Unblocks |
|---|---|---|
| Price authority for parts, gas and paint (price list, or reviewed partner proposal with a threshold) | Owner | COMMERCIAL_HOLD (4 services), with Phase 09 |
| Pay timing, declined-quote policy, refund of unused parts, invoice presentation | Owner | Same |
| Phase 09 build of the additional-quote primitive | Engineering, after the above | Same |
| Work-at-height operating method, provider capability evidence, allowed scope | Owner | SAFETY_HOLD (fasade-cleaning) |

## Final matrix

| AREA | STATUS | EVIDENCE | REMAINING ACTION |
|---|---|---|---|
| Commercial architecture audit | PASS | Capability map; `payments.booking_id` UNIQUE; no price list | — |
| Commercial primitive | BLOCKED (design ready) | Design doc: tables, state machine, Phase 05 reuse, C1–C10 | Owner decisions → Phase 09 build |
| home-painting / ac-service / electrician / plumbing | COMMERCIAL_HOLD | Engine rules; truthful separate-quote copy | Close after Phase 09 |
| fasade-cleaning | SAFETY_HOLD | Audit: no method, 0 certified providers | Owner-defined method |
| Facade equipment promise | FIXED | Live v4: "We bring: Cleaning products" only; browser 7/7 | — |
| window-cleaning | READY_WITH_INSPECTION | Interior-only preserved (browser) | — |
| A1 / A2 / A3 | PASS (OWNER_APPROVED) | 8 lines promoted with audit reason; 3 guards; A1–A3 reintroductions caught | Overridable in tab 09b |
| Content quality | PASS | Engine 0/0; label duplication fixed and ruled out | — |
| Versioning / snapshot | PASS | 7 × v3 → v4; Version-A snapshots byte-identical | — |
| Regression | PASS | 3006/0; Phase 06 69/0; 6 typechecks 0 | — |
| Defect reintroduction | PASS | S1–S4, A1–A3 7/7 caught | C1–C10 ship with Phase 09 |
| Browser | PASS | 7/7 on a live-equivalent copy | — |
| Data integrity | PASS | Financial / snapshot / slot / fixture fingerprints identical | — |
| Migration | PASS (none needed) | Schema drift OK | — |
| Security | PASS | 0 leaks live; hash-bound, actor-verified write | — |
