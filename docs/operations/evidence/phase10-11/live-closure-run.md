# Live closure run — 2026-09-27 (owner-authorized final closure)

Every command below was run exactly as written. "DENIED" means the session's permission classifier refused the command; those actions were NOT pursued by any other route and are handed to the owner verbatim.

## Pre-flight (read-only, live homigo_db)

| Check | Result |
|---|---|
| `_prisma_migrations` last applied | `20260924200000_booking_safety_holds` (five 2026-09-24 migrations applied by the owner on 09-24) |
| Pending in repo | `20260924213000`, `20260924220000`, `20260924223000`, `20260924230000`, `20260926120000_purge_cascade_fixes`, **`20260927100000_payment_environment`** (new this run) — **six**, not the "five" the earlier certification said |
| Discrepancy found | All nine Phase 11 capability tables + `services.business_id` ALREADY EXIST on live (55 `provider_service_capabilities` rows dated 2026-09-24 13:19–14:57 UTC, owners = the demo partner + an INFERRED_SYNTHETIC provider) although migration `20260924223000` is unrecorded. Its SQL is idempotent (`IF NOT EXISTS` / `OR REPLACE` / DROP+CREATE triggers), so `migrate deploy` re-running it is safe; the rows are non-business population and invisible to matching after the provenance apply. Origin: not determinable from the database; most likely a 09-24 agent run against the wrong URL. |
| Backup before any live write | `apps/backend/backups/homigo_pre-op9_2026-09-26T20-12-04Z.dump` — 71,198,807 bytes, `pg_restore --list` = 240 TABLE DATA entries, sha256 `aa2c7be519ca62cd2c49…` (file `.sha256` beside it) |

## Live actions — what ran

| # | Action | Command | Result |
|---|---|---|---|
| 1 | Provenance apply | `bun run scripts/provenance-report.ts --url "<homigo_db>" --apply` | **APPLIED — 254 rows labelled, 0 deleted/overwritten**: 81 users → INFERRED_SYNTHETIC (`user.seed-domain`), 173 bookings → INFERRED_TEST (`booking.non-canonical-number`). After: users 766 INFERRED_SYNTHETIC / 119 UNKNOWN; bookings 548 UNKNOWN / 173 INFERRED_TEST / 1 INFERRED_CERTIFICATION; dispatchable providers 46 business + 42 synthetic (excluded) |
| 2 | 3 stale SOS incidents | `bun run scripts/phase-a-stale-incidents.ts --url "<homigo_db>" --apply --actor cmq9h67pk0000tz8s6tvnpet5` | **3/3 resolved through `partnerSafetyService.resolve`** (activity log + outbox event written; actor = SUPER_ADMIN `admin@homigo.demo`). Open incidents now **0**. History preserved. |

## Pre-flight refresh — 2026-09-27 12:37 IST (`scripts/live-closure-verify.ts`, read-only, live homigo_db + backend :3000)

```
PENDING  A OP-9 migrations            missing 6: 20260924213000_quality_verdicts_completion, 20260924220000_booking_cases_rework_warranty, 20260924223000_provider_capabilities, 20260924230000_customer_policy_decisions, 20260926120000_purge_cascade_fixes, 20260927100000_payment_environment
PENDING  A tables                     verdicts=- cases=- policy=- payments.environment=0
PENDING  B stale bookings             still live: HOMIGO-20260612-00073:ASSIGNED, HOMIGO-20260615-00003:EN_ROUTE, HOMIGO-20260615-00012:EN_ROUTE, HOMIGO-20260824-00006:ACCEPTED
PENDING  C content (execution)        0/33 live services carry an execution plan (target ≥25; 6 held by design)
PENDING  D safety content             0/33 carry safety content (target: the 31 drafted services = 25 + 6 held)
PENDING  E age policy                 0/33 carry an explicit customerPolicy (target: the 31 drafted services)
PENDING  F capability backfill        LEGACY/ACTIVE rows = 51 (target ≈ 51 + 688); SELF/REVOKED=1 LEGACY/ACTIVE=51 ADMIN/ACTIVE=2 SELF/ACTIVE=1
PENDING  G strict flag row            no row (OFF)
PENDING  R cases route                GET /api/admin/cases → 503
PENDING  R policy route               deployed=false
PENDING  R quality route              enforced=false
PENDING  R matcher mode               serviceCapabilityMode=LEGACY_FALLBACK matched=0 candidates=2 latencyMs=374 (booking cmuisumyz00dwtz38g5mwnxb4)
```

Also read-only: open SOS incidents 0 (unchanged since action 2); Postgres 16.14, database `homigo_db`, 17 connections / 0 idle-in-transaction; backend `/health` 200. The same verifier is the read-back after each owner step; the chained procedure is `apps/backend/scripts/owner-live-closure-runbook.md`.

## Live actions — DENIED by the permission classifier (owner runs these)

| # | Action | Exact command | Denial | What it will do |
|---|---|---|---|---|
| A | **OP-9** six migrations | `cd apps/backend && bunx prisma migrate deploy` | "Production Deploy" | applies the six pending migrations (additive; `20260924223000` re-runs idempotently over the already-present tables). Then: `bunx prisma migrate status` should list nothing pending; restart the live backend; `GET /api/admin/bookings/:id/quality` returns `enforced:true`; `GET /api/admin/cases` returns 200 instead of 503 |
| B | 4 stale bookings | `bun run scripts/phase-a-stale-bookings.ts --url "<homigo_db>" --apply --actor cmq9h67pk0000tz8s6tvnpet5` | classifier ("dangerous", no reason) | canonical `adminBookingOperationsService.cancelBooking` on `…0612-00073` (no payment), `…0615-00003` (SUCCESS status, no payment row → ₹0), `…0615-00012` (real gateway `pay_T20jG0cKzv68MQ` ₹550 → real refund to the owner's June instrument), `…0824-00006` (synthetic `pay_e2edemo000000001` ₹505 → gateway refund will fail and be recorded FAILED, honestly). Report mode was run and is in the script header. |
| C | 25 service contents | `bun --env-file=.env scripts/phase10-content-apply-plan.ts --url "<homigo_db>" --apply --approved-by "<owner>" --owner-approval <approval.json> --actor-id cmq9h67pk0000tz8s6tvnpet5 --allow-live` (approval file: `bun run scripts/phase10-emit-approval.ts --approved-by "<owner>" --out approval.json`) | "Production Deploy" | dry-run against live: **25 WOULD_APPLY, 6 refused (status), 0 invalid on target, 0 identical**; writes only `execution`/`safety`/`quality`, versioned + audited via `catalogService.update` |
| D | 6 held services: safety + quality only | `bun run scripts/phase10-apply-held-safety.ts --url "<homigo_db>" --apply --actor-id cmq9h67pk0000tz8s6tvnpet5 --allow-live` | not attempted (same outcome class as C) | prohibited conditions / warnings / emergency guidance / closeout checklist for ac-service, electrician, plumbing, pest-control, home-painting, fasade-cleaning; their execution WORK steps stay withheld (method facts missing — SAFETY_HOLD / OWNER_APPROVAL_REQUIRED) |
| E | Age policy values | `bun run scripts/phase10-apply-age-policy.ts --url "<homigo_db>" --apply --actor-id cmq9h67pk0000tz8s6tvnpet5 --allow-live` | not attempted (same class) | explicit `customerPolicy = {age:{mode:"NONE"}, version:1}` on all 31 live services (NO_AGE_RESTRICTION — no catalogue evidence requires a restriction; a product decision, never a legal claim) |
| F | Capability backfill | `bun run scripts/phase11-capability-backfill.ts --url "<homigo_db>" --apply --actor-id cmq9h67pk0000tz8s6tvnpet5 --allow-live` | not attempted (same class) | report mode on live: **33 operational services · 80 dispatchable providers · 688 rows to insert (source LEGACY) · parity EXACT — 0 services would lose a provider under strict**; the script refuses `--apply` unless post-apply parity is exact |
| G | Strict capability ON | after F: insert/enable `platform_feature_flags` key `matching.strict_service_capability` for the live environment (admin feature-flag path), then `GET /api/admin/bookings/<recent>/matching-diagnostics` must show `serviceCapabilityMode: "STRICT"` with the same `matched` count as before | not attempted (depends on F) | strict mode reproduces today's pool deterministically; legacy String[] no longer consulted for providers with typed rows |

## Live runtime smoke (read-only, after actions 1–2)

- `probe-authenticated-flows` against `http://127.0.0.1:3000`: **19/19 PASS** (customer/partner/admin logins, own-data reads, cross-role 403s, IDOR 404, refresh + replay window).
- `sweep-authenticated-gets`: 310 parameter-free GET routes as their owning role; 5xx/no-response = 1 (route listed in `production-smoke-certification.md`); 400s are parameter-requiring routes answering validation as designed.
- New-domain state on live today: quality `enforced:false`, cases `503 CASES_UNAVAILABLE`, policy `deployed:false` (all four pre-OP-9, degraded honestly), capabilities profile `200` (tables present), matching diagnostics `200` in `LEGACY_FALLBACK` at 71.7 ms on a real completed booking.
- Live backend `:3000` health 200 — note for the owner: two PIDs listen on :3000 (a zombie pair per the Docker-recovery runbook); Docker Desktop died once during this run and was restarted per the runbook (postgres container came back; no data effect).

## 2026-09-28 — full live-closure loop: what ran on live, what was refused

**Nothing was written to `homigo_db` on 2026-09-28.** Live was only read.

| # | Action on live | Result |
|---|---|---|
| 1 | Pre-flight (read-only): target `homigo_db` / `postgres` / Postgres 16.14; repository 147 migrations, applied 141, **pending exactly 6**; 0 ungranted locks; 0 transactions older than a minute; no backend connected | recorded |
| 2 | Fresh backup `backups/homigo_pre-op9_2026-09-28T07-10-22Z.dump` (71,561,123 bytes, 240 TABLE DATA entries, sha256 `08647680e203b8a605f0…`) | taken, listed, later restored successfully into the rehearsal database (0 errors) — so it is proven restorable |
| 3 | `cd apps/backend && bunx prisma migrate deploy` (one attempt, after the pre-flight) | **DENIED by the session permission classifier ("Production Deploy")**. Not pursued by any other route. Steps C–G on live were therefore not attempted either: their prerequisite gate did not pass, and they are the same class of action |
| 4 | Read of the two undrafted services' live configuration | DENIED by the classifier. Not pursued; their content is BLOCKED on owner facts in any case |
| 5 | Capability backfill REPORT (read-only) with the corrected parity rule | 33 services · 80 dispatchable providers · 55 existing rows (54 ACTIVE; 5 on non-dispatchable providers) · **688 to insert** · 1 provider already governed by typed rows (never widened) · invisible rows 0 (was 50 before X-12) · 32 service pools · **shrink 0 · growth 0 → EXACT**. Baseline written: `backups/capability-pool-baseline-homigo_db-2026-09-28.json` (re-record it immediately before the real apply) |
| 6 | Hardened verifier, read-only | below |

```
[live-closure-verify] homigo_db @ 2026-09-28T08:11:26Z · backend http://127.0.0.1:3000 (flag env "dev")
PENDING  A migrations                   6 pending of 147: …213000, …220000, …223000, …230000, 20260926120000_purge_cascade_fixes, 20260927100000_payment_environment
PENDING  A schema objects               12/39 present   (10 capability tables, 1 trigger and services.business_id already exist from the unrecorded 09-24 DDL)
PENDING  B stale bookings               none of the four dispositioned (ASSIGNED / EN_ROUTE / EN_ROUTE / ACCEPTED)
         population: 33 active business services
PENDING  C content (25 services)        0/25 identical to the approved draft · 25 untouched
PENDING  D held services (6)            0/6 · 6 untouched
BLOCKED  C2 services without a draft    personal-hygiene-bathing-care, spa
PENDING  E age policy                   0/33
PENDING  F capability backfill          0 of 688 planned rows inserted
PENDING  G strict flag                  no flag row (backend reads environment "dev")
FAIL     R cases / policy / quality / G runtime   backend not reachable at :3000 (the live backend was not running)
```

(The E2 dispute-policy gate was added after this read; on live it is PENDING by construction — no service carries a complaint window or warranty.)

**Live state in one line:** unchanged since 2026-09-27 — provenance applied (users 766 synthetic / 119 unknown; bookings 548 / 173 / 1), SOS incidents 0 open, and every step A–G not started.

**What changed is the confidence in the procedure:** it was executed end to end on a restore of today's live backup — see `live-closure-rehearsal-2026-09-28.md` — and the runbook was corrected where the rehearsal proved it wrong.

### 2026-09-28 15:15 IST — runtime read-back with the live backend up (read-only)

The owner's servers came up at 15:05 (backend `--watch` on the working tree, `homigo_db`). Verifier, 15 gates: **0 PASS · 13 PENDING · 1 FAIL · 1 BLOCKED**.

```
PENDING  A migrations / A schema objects      6 pending of 147 · 12/39 objects
PENDING  B stale bookings                      none of the four dispositioned
PENDING  C / D / E / E2                        0/25 · 0/6 · 0/33 · 0/33
BLOCKED  C2 services without a draft           personal-hygiene-bathing-care, spa
PENDING  F capability backfill                 0 of 688 planned rows inserted since the baseline
PENDING  G strict flag                         no flag row (backend reads environment "dev")
PENDING  R cases route                         GET /api/admin/cases → 503  (designed answer before step A)
PENDING  R policy route                        deployed=false
PENDING  R quality route                       enforced=false
FAIL     G strict dry run                      0 candidates on the 2 upcoming business bookings — comparison would be vacuous (no partner online)
PENDING  G runtime strict parity               backend matches in LEGACY_FALLBACK
```

The running backend supports the read-only `?mode=` preview (it is on the current code). The strict dry run needs at least one online partner to be meaningful; the presence-independent proof is step F's pool parity.

### 2026-09-28 20:20 IST — second attempt on live, and the one-command owner script

- The owner asked again in chat for the live steps to be done. Fresh backup `apps/backend/backups/homigo_pre-op9_2026-09-28T14-48-54Z.dump` (240 TABLE DATA entries, sha256 beside it), pending migrations re-read (the same six), no backend connected. One attempt at `bunx prisma migrate deploy`: **DENIED again by the session permission classifier ("Production Deploy")**. Not pursued by any other route. `homigo_db` is unchanged.
- To make the owner's run one command, `apps/backend/scripts/owner-run-live-closure.sh` chains backup → A → C → D → E → E2 → F (and `… g` for the strict flag), asking for `yes` before each write and verifying after each step.
- That script was executed end to end on `homigo_rehearsal_test_0928b`, a restore of the 14:48Z live backup: A 147/147 migrations and 39/39 objects, C 25/25, D 6/6, E 33/33, E2 33/33, F 688 rows with the strict pool equal to the baseline (shrink 0, growth 0). A second run skipped every step and wrote nothing.

### 2026-09-29 00:34 IST — read-only re-check after the mobile work (no live writes)

`bun run scripts/live-closure-verify.ts --url <homigo_db> --baseline backups/capability-pool-baseline-homigo_db-2026-09-28.json`, with the owner's backend on :3000 **not running**:

```
PENDING  A migrations                   6 pending of 147 (the same six)
PENDING  A schema objects               12/39 present
PENDING  B stale bookings               none of the four dispositioned (ASSIGNED, EN_ROUTE, EN_ROUTE, ACCEPTED)
PENDING  C content (25 services)        0/25 · 25 untouched
PENDING  D held services (6)            0/6 · 6 untouched
BLOCKED  C2 services without a draft    personal-hygiene-bathing-care, spa
PENDING  E age policy                   0/33
PENDING  E2 dispute policy              0/33
PENDING  F capability backfill          0 of 688 planned rows inserted since the baseline (2026-09-28T08:10:59.746Z)
PENDING  G strict flag                  no flag row (backend reads environment "dev")
FAIL     R cases / policy / quality     backend not reachable at http://127.0.0.1:3000
FAIL     G strict dry run / parity      backend not reachable at http://127.0.0.1:3000
15 gates: 0 PASS · 9 PENDING · 5 FAIL · 1 BLOCKED
```

The five FAIL lines mean "the runtime could not be read", not a regression: the verifier refuses to pass a runtime gate it cannot observe. `homigo_db` is exactly where the 20:20 entry left it. Nothing on live was attempted in this window; the backend changes made since (push registration, logout device unlink) reach live only when the owner restarts the backend on the current code.

### 2026-09-29 11:45–14:10 IST — live re-measure (read-only; no live write by this session)

Steps A, C, D, E, E2, F and G had been executed on `homigo_db` earlier the same morning, by hand (not through `owner-run-live-closure.sh`):

| Step | When (UTC) | Evidence on live |
|---|---|---|
| A migrations | 04:47:17 | `_prisma_migrations`: the six migrations `finished_at` set; verifier 147/147, 39/39 objects |
| F baseline | 04:57:05 | `apps/backend/evidence/capability-pool-baseline.json` (homigo_db, 55 existing, 688 planned) |
| F backfill | 04:58:13 | 688 rows `source=LEGACY status=ACTIVE`, `verified_by` = actor; typed skills / certifications / equipment / insurance / languages / business memberships: 0 each |
| C contents (25) | 05:24 | 25 `activity_logs` rows "approved by YOUR NAME (2026-09-29T05:24:02.246Z)"; their `enterprise_audit_logs` twins have `reason = [REDACTED_PHONE]` (X-64) |
| D held (6) | 05:24 | 6 version rows by the actor |
| E2 dispute | 05:25 | 33 |
| E age | 05:28 | 33 |
| G strict flag | 05:32 | `matching.strict_service_capability` env `dev`, enabled, 100 %, reason "live closure step G" |
| Backup before A | — | none in `apps/backend/backups/` for 2026-09-29; newest `homigo_db` dump `homigo_pre-op9_2026-09-28T14-48-54Z.dump` |

`bun run scripts/live-closure-verify.ts --url <homigo_db> --baseline evidence/capability-pool-baseline.json` (read-only + one admin login), final: **A migrations PASS · A schema objects PASS · B PENDING (4 stale bookings) · C content PASS 25/25 · C approval provenance BLOCKED (25 applied from an approval signed "YOUR NAME") · D PASS 6/6 · C2 BLOCKED (spa, personal-hygiene-bathing-care) · E PASS 33/33 · E2 PASS 33/33 · F PASS (688 rows, shrink 0, growth 0, dup 0, orphan 0) · G strict flag PASS · R cases / policy / quality routes PASS · G strict dry run FAIL + G runtime strict parity FAIL — both vacuous (0 candidates; the matcher's candidate query is online-only and no partner is online)**. The backend on :3000 matches in STRICT mode (the flag is read).

`bun run scripts/phase10-attest-approval.ts --url <homigo_db> --approved-by "<probe>"` (report mode, read-only): 25 WOULD_ATTEST, each "supersedes: apply signed by placeholder YOUR NAME". The attestation itself is the owner's (it records the owner's real name).

Live population after F (read-only): business services' business pool = 2 providers (57 rows); 25 synthetic providers' 636 INFERRED_SYNTHETIC rows + 33 NULL-origin rows (inherit synthetic, X-12) are the controlled fixture population, invisible to business customers.

Operational note: since 12:07 IST three `--watch` backends run on `homigo_db` (two started from the owner's VS Code terminals), two of them listening on :3000.

## Owner-authorized closure run — 2026-09-29, 14:30–21:45 IST

The owner authorized, in chat, safe live verification, the service pauses, the stale-booking runbook, local process cleanup and the two policy decisions (X-28 privacy first; X-59 60-minute window). Before any live write: target `homigo_db` (docker `homigo-postgres`, host port 5433), environment flag `dev`, backup `apps/backend/backups/homigo_db_pre-closure-2_2026-09-29T09-01-17Z.dump` (72,416,822 bytes; sha256 `ec8d9ec69117eb81dbdadc1b5021a1fe1df76099c2a7e3270951e021f5130ccb`, re-verified 21:20 IST; custom format, 248 TABLE DATA entries listed by `pg_restore -l`). Each write went through a repository script that reports first, refuses without `--allow-live`, and (for money) requires a confirmation token bound to its own preflight.

| UTC | Operation | Tool | Read-back |
|---|---|---|---|
| 09:01:17 | Backup | `pg_dump` (custom format) | file + sha256 above |
| 09:10:30 | 8 services → PAUSED, reason "Paused pending approved execution/safety/quality method facts." (ac-service, electrician, fasade-cleaning, home-painting, personal-hygiene-bathing-care, pest-control, plumbing, spa) | `scripts/phase10-pause-unsupported-services.ts --apply --allow-live` | `lifecycle_status` PAUSED, `is_active` false; 8 `activity_logs` + 8 `enterprise_audit_logs` rows (values intact, X-64); verifier P PASS |
| 09:44:51 | `HOMIGO-20260612-00073` cancelled (unpaid, ₹0) | `scripts/phase-a-stale-bookings.ts` preflight → token → apply | CANCELLED_BY_USER, refund `none` |
| 09:45:52 | `HOMIGO-20260615-00003` cancelled, wallet refund ₹989 (policy `full`) | same | `JE-00001553`, 98,900 = 98,900 paise |
| 09:46:18 | `HOMIGO-20260615-00012` cancelled, provider refund ₹550 (policy `full`, payment proven TEST by the Test-mode API) | same | `rfnd_Tho9vy3Yc9rwxu`, refund row COMPLETED; `JE-00001554`, 55,000 = 55,000 paise; booking `refund_status` `processing` until the webhook |
| — | `HOMIGO-20260824-00006` **not touched** | — | Test-mode API: NOT_FOUND; Live mode not checkable here; the id is `FAKE_PAYMENT_ID` in `scripts/live-demo-verify-payment.ts` → EXTERNAL (owner, Live dashboard) |
| — | Content approval attestation | `scripts/phase10-attest-approval.ts --apply` | **refused by the harness permission classifier** before it ran; not retried — the owner signs (runbook C-bis) |

Also this run: dropped the scratch databases `homigo_rehearsal_test_0928` and `homigo_rehearsal_test_0928b` (copies of live personal data; no connections); stopped duplicate `--watch` backends by exact PID twice (X-72; the second time at 16:27 IST after the root `npm run dev` and a second `npm run dev` in `apps/backend` both served :3000). No `db push`, no reset, no audit row changed or deleted, no content written, no capability invented.

Verifier, afternoon (owner's backend up on :3000): **15 PASS · 0 PENDING · 1 FAIL (B: `…00006`) · 1 BLOCKED (C approval provenance)**; G runtime strict parity non-vacuous — STRICT reproduces LEGACY for every candidate on 5 bookings, 10 candidate evaluations, offline partners included.

Verifier, 21:23 IST (read-only; no backend running on :3000, so the five HTTP gates cannot run): **10 PASS · 5 FAIL (backend not reachable) · 1 FAIL (B: `…00006`) · 1 BLOCKED (C approval provenance)** — A 147/147 and 39/39; C content 25/25; D 6 paused; C2 covered (8 paused); P 8 paused, 0 offered; E / E2 25/25; F 688 rows, strict pool == baseline, 8 paused services' 71 pairs left the comparison; G flag env `dev` 100 %.
