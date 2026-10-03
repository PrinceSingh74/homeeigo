# Phase 10 / 11 / 12 — Final Certification

**Date:** 2026-09-29, 21:45 IST edition (supersedes the 14:30 IST edition of the same day) · **Standard:** every status is exactly one of CLOSED / FAIL / BLOCKED / EXTERNAL / OWNER_INPUT_REQUIRED / OWNER_APPROVAL_REQUIRED / NOT_APPLICABLE / OPEN. CLOSED is used only where the claim is proven at the level stated beside it. Three evidence levels are kept apart on purpose:

- **LIVE** — read from or written to `homigo_db`. Since the 14:30 edition this session made **owner-authorized live writes** (listed in §25), each after the backup `homigo_db_pre-closure-2_2026-09-29T09-01-17Z.dump`. There is no production deployment: "the live backend" is the owner's dev backend on `homigo_db` (not running at 21:45 IST).
- **REHEARSAL** — executed on restores of the 2026-09-28 live backups (those scratch databases were dropped today).
- **ISOLATED** — `homigo_test`, the isolated stack (:3100 backend on `homigo_test`, `/health` → `isolatedDatabase: true`, zero-egress preload), the Android emulator (AVD Homigo_API36, `adb reverse` for 3100 / 8082 only) or a headless browser against that stack (partner web :3012). **No mobile client has been run against the live backend; no physical phone and no iOS device were used; no push was delivered.**

Evidence files: `docs/operations/evidence/phase10-11/` — `live-closure-run.md` and `defect-matrix.md` (both: section "Owner-authorized closure run"), `live-closure-rehearsal-2026-09-28.md`, `matching-final-certification.md`, `provider-provenance-closure.md`, `production-smoke-certification.md`, `p10-*.md`.

## 0. The one-paragraph truth

On the owner's authorization this evening the live database was brought as far as it can go without the owner's own signature and a Razorpay Live lookup: the eight services without approved method facts are **paused** (not offered, not bookable), three of the four stale bookings are closed with balanced journals, the rehearsal copies of live data are dropped, and duplicate backends were stopped. The owner's two policy decisions are implemented and proven: **X-28** partners never receive the customer's full number (no relay → the call is withheld and the partner is pointed to chat) and **X-59** GPS tracking starts only inside a 60-minute window before the job (unset → 60; invalid → fail closed). Runtime strict matching is now proven on live **non-vacuously** (5 bookings, 10 candidate evaluations). On the emulator the partner app showed two new device-only defects on the Live Map — a crash in a build without a Maps key (X-74) and, hidden behind it, a permission-prompt loop that closed the app (X-75) — both fixed and re-proven on the device; partner web ignored a safety hold on its primary button (X-73), fixed and browser-proven. Full regression is green (backend 4,067 / 0 / 10 skip). **Phase 10/11 is engineering-closed; live closure is complete except three owner-only items: the content-approval attestation (C), the Live-mode lookup for `HOMIGO-20260824-00006` (B), and shipping the client builds.**

## 1. Status matrix

| Domain | Engineering / rehearsal proven | Live (2026-09-29) | Status | Next action |
|---|---|---|---|---|
| Migrations (6) | fresh-DB rebuild PASS; rehearsal 147/147, 39/39 | **147/147 applied, 39/39 objects** | CLOSED (LIVE) | — |
| Service content — 25 services | draft `2026-09-28.draft.2`, validator 0 | **25/25 identical to the approved draft** | CLOSED (LIVE) for content | — |
| Content approval provenance | placeholder guard (X-65), provenance gate + attestation tool (X-66, now with `--note`) | **BLOCKED: 0/25 name a real approver** (applied from an approval signed "YOUR NAME"); an automated attestation was refused by the harness — only the owner may sign | OWNER_INPUT_REQUIRED | owner runs runbook C-bis |
| Six held services | WORK steps withheld | **PAUSED** 09:10:30 UTC ("Paused pending approved execution/safety/quality method facts."); content 6/6 as drafted | CLOSED (LIVE) as paused | method facts, then reactivate |
| `spa`, `personal-hygiene-bathing-care` | nothing may be invented | **PAUSED** 09:10:30 UTC; no content | CLOSED (LIVE) as paused; content BLOCKED on owner facts | owner facts; decide the one upcoming paid spa booking |
| Safety engine, holds, incidents | §9 suites; X-55 admin holds; X-60 release push | engine live; hold / release proven on **partner web (browser)** and **partner app (emulator)** without reopening the job | CLOSED (engine LIVE; clients ISOLATED) | — |
| Age policy / dispute window + warranty | evidence-gated NONE v1; published 48-hour promise | **25/25** active business services | CLOSED (LIVE) | — |
| Quality verdict / completion / warranty / cases | server-derived, append-only | routes answered on live this afternoon; not re-read at 21:23 (no backend running) | CLOSED (LIVE routes; flows ISOLATED) | — |
| Execution steps — evidence per kind (X-67) | NOTE / PHOTO / BEFORE_AFTER_PHOTOS from both partner apps | the owner's partner web on :3002 served the new code this afternoon (chunk probe) | CLOSED (ISOLATED); partner app build not distributed | ship partner builds |
| Provider capability model | typed rows, DECLARED → VERIFIED | 743 rows (55 + 688 LEGACY, parity-gated); 0 skill / certification / equipment / insurance / language / membership rows — nothing invented | CLOSED (representation); data = OWNER / OPERATIONS | real providers declare + get verified |
| Capability backfill (F) | rehearsal 688 exact | **PASS: 688 rows, strict pool == baseline** (8 paused services' 71 pairs excluded) | CLOSED (LIVE) | — |
| Strict matching (G) | preview `includeOffline` (diagnostics only) | flag ON (env `dev`, 100 %); **STRICT == LEGACY for every candidate on 5 bookings, 10 evaluations** (afternoon) | CLOSED (LIVE) | — |
| Fixture isolation | disjoint populations at every selection surface | business pool vs 25 synthetic providers; suites green tonight | CLOSED (LIVE, population level) | — |
| Partner execution brief / X-28 | call withheld (409 `CALL_RELAY_UNAVAILABLE`), chat pointer, both clients | code in the working tree; takes effect when the backend on `homigo_db` next starts | CLOSED (owner policy; ISOLATED browser + device) | a masked relay stays EXTERNAL |
| GPS travel window (X-59) | 60 min, fail closed; 12 tests | same as above | CLOSED (owner policy; ISOLATED device) | — |
| Audit log integrity | X-64 in-place scrub | **observed on live writes** (8 pause rows keep ids and reasons); 28,003 historical rows kept as they are | CLOSED (LIVE, forward) | — |
| Four stale bookings (B) | token-bound script | **3/4 closed**: 00073 ₹0; 00003 wallet ₹989 (`JE-00001553` balanced); 00012 ₹550 TEST refund (`JE-00001554` balanced). **00006 untouched** | 3 CLOSED (LIVE); 00006 EXTERNAL | Live-mode dashboard lookup, then runbook B |
| Push (X-45 / X-46) | bounded retry, dedupe, FAILED marking, metrics | no credentials | code CLOSED; delivery EXTERNAL | FCM / APNs / EAS credentials |
| Partner Live Map (X-74 / X-75) | fallback without a Maps key; no permission loop | — | CLOSED (ISOLATED device) | a restricted partner Maps key (EXTERNAL) |
| Full regression | §32 | — | CLOSED (green) | — |

## 2. Architecture (unchanged; nothing was rebuilt)

One booking FSM (+ DB terminal trigger), one quote engine, one matcher, one safety system, one execution system, one refund orchestrator, one provenance policy module. Tonight's changes extend, never replace: pausing uses the catalogue's own lifecycle transition; stale bookings go through the existing cancel / refund orchestrator; the travel window is one pure module read by the existing tracking service; the call policy is a flag in the existing contact service; push retry lives inside the existing delivery service; the matcher gained a diagnostics-only preview flag; each partner client got small pure helpers (`customer-call`, `maps-availability`, `map-location-permission`, `primaryControlState`).

## 4. Per-service completeness (population: 33 business services, 25 active)

| | COMPLETE (active) | PAUSED — held (method facts) | PAUSED — no content | PARTIAL | INVALID |
|---|---|---|---|---|---|
| LIVE (2026-09-29 21:23 IST) | 25 | 6 | 2 (`spa`, `personal-hygiene-bathing-care`) | 0 | 0 |

Not configured, stated plainly: per-step `estimated_time`, `completion_criteria`, `medical_disclaimer` (3 services), guarantee text; no canonical home for `chemical_restrictions`, `incident_protocol`, `damage_policy`. BLOCKED on owner facts, not defects.

## 15. Provider profile completeness (live, read-only)

Unchanged: 80 dispatchable providers = 39 business + 41 synthetic. Of the business providers, 2 carry service capability rows (57); 0 have a typed skill, certification, equipment, insurance, language or membership row. The 688 backfilled rows are the providers' own legacy service lists under a parity gate. Nothing was inferred or invented.

## 16. Partner execution brief

As in the 14:30 edition, plus: **the full customer number is never given to a partner** (X-28, owner decision) — `POST /api/bookings/:id/call` answers 409 `CALL_RELAY_UNAVAILABLE` with `alternative: "CHAT"`, the attempt is logged without the number, and both partner clients show "Call +91 •••• NNNN · unavailable" with a pointer to the job chat. Open: LOW X-29.

## 24. Mobile (ISOLATED — emulator AVD Homigo_API36 against :3100 on `homigo_test`)

| Run | What was driven | Result |
|---|---|---|
| 09-28 / 09-29 (earlier editions) | customer V1–V5, partner P1–P8, R1–R3, step-evidence shapes | PASS after fixes X-38 … X-69 |
| 09-29 15:40–16:10 IST — partner app, fixture `x60rt-mumi14uj` | **X-28:** job screen call control; **X-60:** admin places / releases a hold while the job screen stays open; **X-62:** device location off through job, background → foreground, Live Map, cold start, sign out → login → sign in; **X-59:** job two days ahead, location on, six GPS fixes | X-28 "Call +91 •••• 5391 · unavailable", disabled, tap → 0 `/call` requests, no dialer. X-60 hold → "⛔ Stop — safety hold", Start disabled; release → Start enabled; push frame + immediate refetch in the backend log. X-62: 0 Play-services dialogs in every state. X-59: 4 pings dropped as `outside_travel_window`, booking ACCEPTED, `en_route_at` NULL, 0 tracking rows. **Found on the device:** Live Map crash without a Maps key (X-74) → fixed → then a permission-prompt loop that closed the app (X-75) → fixed → re-run: "Map unavailable" + job chips, 1 prompt on open, 0 across 3 background cycles, 0 task removals. Low: two tracking sockets per live job (X-76) |

Static: customer `test:logic` 94/94, Jest 72/72; partner `test:unit` 85/85; `tsc` 0 / 0. **Not done:** push delivery (EXTERNAL); a physical phone; iOS; a partner build with a real Maps key.

## 25. Database safety

No `db push`, no reset, no destructive statement outside the authorized cleanup, no audit row changed or deleted, no content written, no capability invented. **Live writes this evening (owner-authorized), all after backup `apps/backend/backups/homigo_db_pre-closure-2_2026-09-29T09-01-17Z.dump`** (72,416,822 bytes, custom format, 248 TABLE DATA entries, sha256 `ec8d9ec6…0ccb`, re-verified): 8 service pauses (09:10:30 UTC) with 8 + 8 audit rows; three stale-booking cancellations with their refunds (09:44–09:46 UTC). Also: dropped `homigo_rehearsal_test_0928` and `…_0928b` (copies of live personal data). Other scratch copies (`homigo_db_reconcile_clone`, `homigo_dr_*`, `homigo_shadow_*`) remain — the owner's decision. Read-only schema audit: 0 invalid constraints; 14 duplicate index groups from the first migration (left for an owner-reviewed migration). Test-DB fixtures of tonight's runs removed with the helper's cleanup (0 adversarial users left).

## 27. Browser evidence — partner web, isolated stack

As before, plus (fixture `x60rt-mumi14uj`, :3012 → :3100, 0 requests to :3000): a hold placed through the admin API disables "Start job" 1,116 ms later with the hold sentence (X-73); release re-enables it; 0 navigations; the call control reads "Call +91 •••• 5391 · unavailable", disabled, 0 `/call` requests.

## 28. Accessibility

2026-09-28 scans stand. The new controls (disabled call control with its note, "Map unavailable" fallback, the primary-button blocked note) carry text / roles but were **not re-scanned**.

## 29. Defects

Since the 14:30 edition (all in `defect-matrix.md`, section "Owner-authorized closure run"): **fixed** X-28 and X-59 (owner policies), X-45 (code), X-73, X-74, X-75 — each with a test that was red first; X-73 in a browser, X-28 / X-59 / X-74 / X-75 also on the emulator; X-60 and X-62 re-proven on the device; X-64 observed on live writes. **Owner:** X-66 (attestation), X-72 (the launch habit that starts two backends). **Open, LOW:** X-29, X-56, X-70, X-76, duplicate indexes. **External:** X-46 (push credentials), partner Maps key, a masked-call relay, Razorpay Live lookup for `…00006`.

## 30. What only the owner can do (`apps/backend/scripts/owner-live-closure-runbook.md`)

1. **Attest the content approval** (runbook C-bis, with your real name and an optional `--note`) — the verifier's "C approval provenance" then PASSes.
2. **`HOMIGO-20260824-00006`:** look up `pay_e2edemo000000001` in the Razorpay dashboard in **Live** mode (Test mode: NOT_FOUND; the id is `FAKE_PAYMENT_ID` in `scripts/live-demo-verify-payment.ts`), then runbook B (`--provider-mode-verified NOT_FOUND`, policy `full` recommended).
3. `…00012`: the refund row is COMPLETED; the booking's `refund_status` reads `processing` until Razorpay's webhook arrives — reconcile from the dashboard if it never does; do not re-run.
4. **Ship the client fixes:** partner web and the partner app need a build / redeploy (X-67, X-28, X-73, X-74, X-75); the partner app has no EAS project or store listing yet.
5. Decide the paused services' bookings: one upcoming paid spa booking; 21 older open bookings of paused services (mostly synthetic).
6. Method facts for the eight paused services, then reactivate them one by one.
7. Start **one** backend (the root `npm run dev` already includes it — X-72), then re-run `live-closure-verify.ts --baseline evidence/capability-pool-baseline.json` so the five HTTP gates read again.
8. Credentials: a restricted Maps key for `com.homeeigo.partner`; FCM / APNs / EAS for push. Optional: drop the remaining scratch copies of live data; a migration for the duplicate indexes.

## 31. EXTERNAL

BigQuery billing (ETL dead since 2026-08-19) · Google Maps web-service billing and a partner-app Maps key · FCM / APNs / EAS credentials (X-46) · a telephony relay for masked calls (X-28: until one exists, calling stays withheld by policy) · Razorpay Live dashboard for `…00006`.

## 32. Regression (2026-09-29 evening, this edition's code)

| Suite | Result | Note |
|---|---|---|
| Backend full run | **4,067 pass · 0 fail · 10 skip · 337 files · 83,113 expects · 792 s · exit 0** | 15:48–16:02 UTC, no other backend running. The 10 skips are `razorpay-test-mode.real.test.ts`. An earlier attempt that spanned hours of machine idle (per-test times up to 9,463,706 ms) was discarded, not triaged |
| Backend injection files | `data-archival-failure-injection.inject` 6/6 · `event-bus.inject` 7/7 | |
| Backend scripts outside `tsconfig` | `phase10-attest-approval`, `phase10-pause-unsupported-services`, `live-closure-verify`, `phase-a-stale-bookings`, `phase10-emit-approval` — tsc 0 errors (15 script files loaded); the same config with a planted error fails (TS2322) | the project `tsc` does not include `scripts/` |
| Customer web | 38 / 38 | |
| Partner web | 71 / 71 · lint 0 errors | +5 (call control 2, primary control 3) |
| Customer mobile | `test:logic` 94 / 94 · Jest 72 / 72 | |
| Partner mobile | 85 / 85 | +6 (call control 2, maps availability 2, map permission 2) |
| Typecheck | backend 0 · customer web 0 · partner web 0 · admin 0 · customer mobile 0 · partner mobile 0 | |
| Live verifier (21:23 IST, read-only) | 10 PASS · 1 FAIL (B: `…00006`) · 1 BLOCKED (C provenance) · 5 FAIL "backend not reachable" | afternoon run with the owner's backend up: 15 PASS · 1 FAIL (B) · 1 BLOCKED (C) |

## 33. Certification statement

**Phase 10 and Phase 11: ENGINEERING-CLOSED and TEST-PROVEN (full regression green). LIVE-VERIFIED:** migrations, 25 contents, the eight paused services (not offered), age and dispute policies, capability backfill with exact pool parity, strict flag and non-vacuous runtime strict parity, audit integrity going forward, three of four stale bookings with balanced journals. **Owner-only, not done:** the content-approval attestation, the Live-mode lookup and closure of `HOMIGO-20260824-00006`, and shipping the partner builds (web and app). Device evidence is from the Android emulator only — no physical phone, no iOS, no push delivery. No claim of completion, perfection or zero risk is made.

## 34. Final engineering closure addendum (2026-09-30, 04:10 IST)

Since the 21:45 edition the owner attested the 25 contents (Prince Singh, 16:31 UTC) and closed `HOMIGO-20260824-00006` (17:41 UTC). Live verifier with the owner's backend up: **16 PASS · 1 PENDING · 0 FAIL · 0 BLOCKED** — the pending gate is the new duplicate-index migration (owner runbook step H). Details: `docs/operations/evidence/phase10-11/defect-matrix.md`, section "Final engineering closure".

| Item | Result | Status |
|---|---|---|
| X-76 duplicate GPS publisher | shared, reference-counted publisher; 13 tests; emulator tracking room size 1 (was 2) | CLOSED |
| X-56 job-screen over-fetch | by-id only; 0 list requests when a job is opened (was ~13) | CLOSED |
| X-70 keyboard-swallowed taps | 11 scrollables incl. 3 sibling files; sweep test in `test:logic` | CLOSED |
| X-29 partner data minimisation | refund / fee / tender, storage keys, raw media URLs, assignment-job id removed from partner payloads and frames | CLOSED (engineering); admin free-text wording = OWNER_DECISION_REQUIRED |
| Duplicate indexes (14) | hand-scoped migration proven on a fresh replay and on a restore of the live dump; test-DB schema parity (4 `map:` names) | CLOSED in repo; live = OWNER (runbook step H) |
| X-77 / X-78 / X-79 release paths | partner web `build:release`; partner app `android:release` (release APK built); Maps key validation | CLOSED; upload key / production Maps key / Live Razorpay key = EXTERNAL |
| X-80 E2E wrote to live | 4 live `refresh_tokens` rows (synthetic demo partner) from this pass's E2E runs; the mint script is now behind `requireDeclaredTarget` | CLOSED (guard); revoking the 4 rows = OWNER (one statement in the matrix) |
| X-82 regression introduced by X-73 | lifecycle mutations now refresh the job-actions answer; browser Offer → Complete passes | CLOSED |
| X-83 compliance contrast | fixed | CLOSED |
| X-84 demand-forecast 500 when the warehouse is unreachable | proposed contract, not implemented | OPEN (MEDIUM, outside Phase 10/11 core) |
| Regression | backend 4,080 / 0 / 10 skip (340 files, 565 s) + injection 6/6, 7/7; customer web 38/38; partner web 79/79; customer mobile 96/96 + Jest 72/72; partner mobile 112/112; tsc 0 in all six projects; partner-web lint 0 errors | PASS |
| Partner web E2E (production build, isolated stack) | 64 passed · 3 failed · 1 flaky — the 3 are CI-seed data, shared-test-DB state and load (each explained in the matrix); live DB untouched during the run | PASS for product flows; 3 environment items |
| Builds | partner web ✓ (postbuild guards ✓); admin ✓; partner app release APK ✓; customer web compiles but its bundle budget **fails** on `/services` (uncommitted catalog work from outside this pass) | customer web = FAIL (owner of that work) |

Still true: no physical phone, no iOS, no push delivery; the Android evidence is from the emulator.
