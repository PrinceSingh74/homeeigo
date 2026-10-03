# Owner live-closure runbook — homigo_db (steps A → G)

Written for the owner running the live actions the agent session is not permitted to run. Every step is idempotent and report-first; each ends with a read-back from `scripts/live-closure-verify.ts` (read-only) that must show the step PASS before the next one starts. Nothing here bypasses a control: the scripts refuse a non-test database without `--allow-live`, refuse `--apply` without an active SUPER_ADMIN, and the backfill refuses unless the pool stays exactly the same.

**Rehearsed end to end on 2026-09-28** on `homigo_rehearsal_test_0928` — a restore of that morning's live backup on the same Postgres 16.14 server, with a backend on :3100 that could not reach any outside service. Result: A, C, D, E, F, G and the runtime checks all PASS (12 of 14 gates); B was not rehearsed because it moves money; C2 is BLOCKED (below). Two planted faults were caught (a flag written for the wrong environment; one backfilled row suspended). Full output: `docs/operations/evidence/phase10-11/live-closure-rehearsal-2026-09-28.md`.

The rehearsal also found three defects in the procedure itself, all fixed before this version: step G wrote the flag for environment `production`, but the backend on this machine reads `dev` (strict would have stayed off); the content apply lost the audit row of its last change (the script now waits for audit writes before exiting); the verifier used `≥ N` thresholds (now exact sets, baseline-bound parity, and FAIL on a vacuous comparison).

## Shortest path — one command

```bash
cd /d/homigo/apps/backend
# 1. stop your backend on :3000, then:
bash scripts/owner-run-live-closure.sh        # backup → A → C → D → E → E2 → F
# 2. start your backend again (bun run dev), then:
bash scripts/owner-run-live-closure.sh g      # G strict flag, for the environment the backend reads
```

The script asks you to type `yes` before every write, asks your name for the content approval, runs the read-only verifier after each step and stops at the first step that does not verify. Running it again skips whatever is already applied. It was run end to end on 2026-09-28 against `homigo_rehearsal_test_0928b` (a restore of that evening's live backup): A, C, D, E, E2, F all PASS, 688 capability rows, pool unchanged; the second run skipped every step and wrote nothing. Step B (the four stale bookings) is deliberately not in the script — it moves money and needs your dashboard lookup; see section B below. The sections below are the same steps by hand.

## 0. Before you start

```bash
cd /d/homigo/apps/backend
export DB_URL="$(grep '^DATABASE_URL=' .env | cut -d= -f2-)"    # must end in /homigo_db
export ACTOR=cmq9h67pk0000tz8s6tvnpet5                             # SUPER_ADMIN admin@homigo.demo (active on live)
export FLAG_ENV="$(grep '^APP_ENV=' .env | cut -d= -f2-)"          # the environment the backend reads flags for — "dev" today
export BASELINE=backups/capability-pool-baseline-homigo_db-$(date -u +%Y-%m-%d).json
bun run scripts/live-closure-verify.ts --url "$DB_URL"             # baseline read: expect A–G PENDING, C2 BLOCKED
```

1. **Backup.** Taken today before anything: `backups/homigo_pre-op9_2026-09-28T07-10-22Z.dump` (71,561,123 bytes, 240 TABLE DATA entries, sha256 in the `.sha256` beside it). A fresh one: `docker exec homigo-postgres pg_dump -U postgres -Fc homigo_db > backups/homigo_pre-op9_$(date -u +%Y-%m-%dT%H-%M-%SZ).dump`.
2. **Stop every `--watch` backend on homigo_db** (`netstat -ano | findstr :3000`), so no hot-reload races the migration. Restart it after step A **on the current working tree** — the runtime checks and step G need this code (the read-only `?mode=` preview, the capability provenance fix, the audit drain).
3. `bunx prisma migrate status` also reports `20260817090000_notification_delivery_claim` as "applied on the database but not found locally". That is a pre-existing history note; `migrate deploy` warns about it and continues (rehearsed).

## A. Six additive migrations

```bash
bunx prisma migrate status      # expect exactly these 6 pending: 20260924213000_quality_verdicts_completion, 20260924220000_booking_cases_rework_warranty,
                                #   20260924223000_provider_capabilities, 20260924230000_customer_policy_decisions,
                                #   20260926120000_purge_cascade_fixes, 20260927100000_payment_environment
bunx prisma migrate deploy
bunx prisma migrate status      # expect: "Database schema is up to date!"
# restart the backend on :3000, then:
bun run scripts/live-closure-verify.ts --url "$DB_URL"
```

PASS means: "A migrations" (147/147) and "A schema objects" (39/39 tables, triggers, constraints, columns), and "R cases route" 200, "R policy route" deployed=true, "R quality route" enforced=true. `20260924223000` re-runs idempotently over the nine capability tables already on live; the 55 existing rows are untouched (rehearsed: 55 before, 55 after).

## B. Four stale bookings — one at a time

**Status 2026-09-29 (owner-authorized run, after backup `backups/homigo_db_pre-closure-2_2026-09-29T09-01-17Z.dump`):** three are done — `…00073` cancelled, ₹0 (unpaid; 09:44:51 UTC); `…00003` cancelled, wallet refund ₹989 (journal `JE-00001553`, balanced; 09:45:52 UTC); `…00012` cancelled, full refund ₹550 `rfnd_Tho9vy3Yc9rwxu` on `pay_T20jG0cKzv68MQ`, which the Razorpay API returned to the Test-mode key (a Test key cannot see Live payments, so the payment is **TEST**) (journal `JE-00001554`, balanced; refund row COMPLETED; the booking's `refund_status` still reads `processing` until the refund webhook arrives — do not re-run). **Only `…00006` is left:** the Test-mode API answered NOT_FOUND for `pay_e2edemo000000001`, but Live mode could not be checked (no Live key here) — look it up in the Razorpay dashboard in **Live** mode (the repository's `scripts/live-demo-verify-payment.ts` writes that id as `FAKE_PAYMENT_ID`, so `NOT_FOUND` is expected), then:

```bash
bun run scripts/phase-a-stale-bookings.ts --url "$DB_URL" --only HOMIGO-20260824-00006 --refund-policy full --provider-mode-verified NOT_FOUND   # preflight + token
bun run scripts/phase-a-stale-bookings.ts --url "$DB_URL" --only HOMIGO-20260824-00006 --refund-policy full --provider-mode-verified NOT_FOUND \
  --confirm <token> --apply --actor "$ACTOR" --allow-live
```

**This step moves money and cannot be undone** (a cancelled booking cannot leave its terminal state, a wallet credit is spendable at once, a provider refund cannot be recalled). It was not rehearsed.

| Booking | Today | Tender | `customer_policy` | `full` | What happens |
|---|---|---|---|---|---|
| HOMIGO-20260612-00073 | ASSIGNED, unpaid | none | ₹0 | ₹0 | nothing refunded, recorded or announced |
| HOMIGO-20260615-00003 | EN_ROUTE, paid | wallet (₹989 debit, no payments row) | ₹741.75 | ₹989.00 | customer wallet credited; no provider call |
| HOMIGO-20260615-00012 | EN_ROUTE, paid | gateway `pay_T20jG0cKzv68MQ` ₹550 | ₹412.50 | ₹550.00 | one provider refund with the credential this process holds |
| HOMIGO-20260824-00006 | ACCEPTED, paid | gateway id `pay_e2edemo000000001` (fabricated by a demo script, labelled `wallet`) | ₹378.75 asked | ₹505.00 asked | the provider rejects an id it never issued → recorded FAILED; no money moves, no wallet credit |

Decisions only you can make: (1) look up `pay_T20jG0cKzv68MQ` in the Razorpay dashboard in **both** Test and Live mode → `LIVE`, `TEST` or `NOT_FOUND`; (2) the same for `pay_e2edemo000000001` (expected `NOT_FOUND`); (3) `customer_policy` or `full` per booking — the engineering recommendation is `full` (Homeeigo is closing bookings it never delivered); (4) whether `…00003` is cancelled at all, since it credits a wallet. `.env` holds a `rzp_test_` credential: a Test credential cannot refund a Live payment, and the script refuses rather than try.

```bash
bun run scripts/phase-a-stale-bookings.ts --url "$DB_URL"                                         # all four, both policies, read-only
bun run scripts/phase-a-stale-bookings.ts --url "$DB_URL" --only HOMIGO-20260615-00012 \
  --refund-policy <customer_policy|full> --provider-mode-verified <LIVE|TEST|NOT_FOUND>           # PREFLIGHT + CONFIRMATION TOKEN
bun run scripts/phase-a-stale-bookings.ts --url "$DB_URL" --only HOMIGO-20260615-00012 \
  --refund-policy <…> --provider-mode-verified <…> --confirm <token> --apply --actor "$ACTOR" --allow-live
```

`--provider-mode-verified` applies to `…00012` and `…00006` only. Read-back: verifier "B stale bookings" lists each booking terminal with its refund row; a refund left `INDETERMINATE`/`PROCESSING` is a FAIL — **do not re-run**; find it in the dashboard by the note `homigo_operation = cancel-refund:<bookingId>` and reconcile from there. Gate B passes only when all four are terminal; if you decide not to cancel one, record that decision in `live-closure-run.md` and B stays PENDING.

## C. 25 service contents (hash-bound approval)

The draft is now version `2026-09-28.draft.2` (six low-risk services gained safety warnings taken from their own steps and stop conditions). An approval file from the earlier draft is refused — emit a new one.

```bash
bun run scripts/phase10-content-validate.ts                                    # expect: violations=0
bun run scripts/phase10-service-completeness.ts --draft                        # expect: COMPLETE=25 HELD=6 PARTIAL=0 INVALID=0
APPROVAL="backups/phase10-approval-$(date -u +%Y-%m-%dT%H-%M-%SZ).json"   # a NEW file every time — the emitter never overwrites one
read -r -p "Your name, as the approving owner: " OWNER_NAME                 # never paste a placeholder: "YOUR NAME", "<your name>", empty → exit 2
bun run scripts/phase10-emit-approval.ts --approved-by "$OWNER_NAME" --out "$APPROVAL"
bun run scripts/phase10-content-apply-plan.ts --url "$DB_URL" --summary        # expect: 25 would apply · 6 refused (status) · 0 invalid on target
bun run scripts/phase10-content-apply-plan.ts --url "$DB_URL" --summary --apply --allow-live \
  --approved-by "$OWNER_NAME" --owner-approval "$APPROVAL" --actor-id "$ACTOR"
```

Writes only `execution` / `safety` / `quality` through `catalogService.update` (version bump, `service_config_versions` row, audit). Read-back: "C content" PASS = 25/25 identical to the approved draft and each current version written by `$ACTOR`. Running the apply again prints `0 applied · 25 identical` (rehearsed).

### C-bis. Approval provenance (content already applied under a placeholder approver)

On 2026-09-29 the 25 contents were applied from an approval signed "YOUR NAME". Those audit rows stay as they are. Put your real name on the exact content that is live — this appends one attestation row per service and changes no content:

```bash
read -r -p "Your name, as the approving owner: " OWNER_NAME
bun run scripts/phase10-attest-approval.ts --url "$DB_URL" --approved-by "$OWNER_NAME"          # report: expect 25 WOULD_ATTEST
bun run scripts/phase10-attest-approval.ts --url "$DB_URL" --approved-by "$OWNER_NAME" --note "<how you gave the approval, e.g. reviewed the draft on 2026-09-29>" \
  --apply --actor-id "$ACTOR" --allow-live
```

`--note` is optional and is stored with each attestation row (placeholders such as `<…>` are refused). Still open on 2026-09-29 21:23 IST: this has to be run by you — an automated session may not sign with the owner's name.

Read-back: verifier "C approval provenance" PASS (25/25 by owner attestation). A service whose live content is not the approved draft is reported NOT_IDENTICAL and is never attested.

## D. Six held services

```bash
bun run scripts/phase10-apply-held-safety.ts --url "$DB_URL"                                        # report: 6 × WOULD_APPLY execution, safety, quality
bun run scripts/phase10-apply-held-safety.ts --url "$DB_URL" --apply --actor-id "$ACTOR" --allow-live
```

ac-service, electrician, fasade-cleaning, home-painting, pest-control, plumbing get their safety (prohibited conditions, warnings, emergency guidance), quality checklist, and the **non-method** execution steps (arrival and scope, stop checks, quality check, closeout). Method-dependent WORK steps stay withheld — nobody may invent gas, electrical, height or treatment procedures — and the script refuses a held draft that carries a WORK step. Read-back: "D held services" 6/6. Re-run prints 6 × SKIP_IDENTICAL (rehearsed).

## E. Age policy

```bash
bun run scripts/phase10-apply-age-policy.ts --url "$DB_URL"                                          # report
bun run scripts/phase10-apply-age-policy.ts --url "$DB_URL" --apply --actor-id "$ACTOR" --allow-live
```

The population is read from the database: every active business service (33 today, including spa and personal-hygiene-bathing-care). Each gets `customerPolicy = { age: { mode: "NONE" }, version: 1 }` **only if** its catalogue carries no booking-age statement ("18+", "minimum age", "adults only", "minors"); a service that does is printed as OWNER_DECISION_REQUIRED and left alone, and an existing different policy is never overwritten. Household mentions ("an adult must be present", "tell us if anyone is elderly") are requirements, not booking-age rules. Rehearsal: 33 applied, 0 owner decisions, re-run 33 identical. This is a product decision, not a legal statement.

## E2. Published dispute policy — complaint window and rework warranty

Found on 2026-09-28: no live service carries a complaint window or a warranty, so after step A every booking would freeze "no complaint window" and **a customer could not report an issue on any booking** (`COMPLAINT_WINDOW_NOT_CONFIGURED`) — while the published Refund & Cancellation Policy promises a 48-hour dispute window and a free rework first.

```bash
bun run scripts/phase10-apply-published-dispute-policy.ts --url "$DB_URL"                                          # report
bun run scripts/phase10-apply-published-dispute-policy.ts --url "$DB_URL" --apply --actor-id "$ACTOR" --allow-live
```

It encodes your own published text ("Quality Disputes & Rework"), clause by clause and nothing more: dispute window 2 days from completion; warranty 2 days covering quality and incomplete work; photos not mandatory; free rework offered first (fee waived); refund allowed after review (a case decides; one refund per case). Damage, behaviour and billing issues can still be reported and inspected inside the window but are not auto-covered — the published text does not promise that. A service on which you already set a different warranty or window is left alone. A test pins the legal wording, so changing the published policy forces this to be revisited. Rehearsal: 33 applied, re-run 33 identical, steps C/D/E unchanged. Read-back: "E2 dispute policy" 33/33.

If 48 hours / free-rework-first is **not** what you want the product to enforce, do not run this step — change the published policy first; the two must agree.

## F. Capability backfill — exact pool parity

Record the baseline **immediately** before applying, from the same database:

```bash
bun run scripts/phase11-capability-backfill.ts --url "$DB_URL" --write-baseline "$BASELINE"   # expect: 33 services · 80 providers · 688 rows · shrink 0 · growth 0 → EXACT
bun run scripts/phase11-capability-backfill.ts --url "$DB_URL" --apply --actor-id "$ACTOR" --allow-live
bun run scripts/live-closure-verify.ts --url "$DB_URL" --baseline "$BASELINE"
```

The backfill writes typed rows (source LEGACY) only for providers that have **no** typed row yet, from their legacy service list; a provider already governed by typed rows is never widened. Skills, certifications, equipment, insurance and languages are not touched — unknown stays unknown. Parity is re-read from the database inside the transaction; any shrink or growth rolls the whole insert back. Read-back: "F capability backfill" PASS = rows = 55 + 688, every row written since the baseline is LEGACY / ACTIVE / by `$ACTOR` / same provenance as its provider, and the strict pool equals the recorded pool for every service (shrink 0, growth 0), no duplicates, no orphans (rehearsed: exactly this).

## G. Strict service capability ON

First the dry run (read-only, needs the backend restarted on the current code):

```bash
bun run scripts/live-closure-verify.ts --url "$DB_URL" --baseline "$BASELINE"    # "G strict dry run" must be PASS before you continue
```

Then enable through the admin route — **with the environment the backend reads (`$FLAG_ENV`, "dev" today), not "production"**:

```bash
PW=$(grep -oE 'DEMO_PASSWORD = "[^"]+"' scripts/ensure-demo-users.ts | cut -d'"' -f2)
TOKEN=$(curl -s -X POST http://127.0.0.1:3000/api/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"admin@homigo.demo\",\"password\":\"$PW\",\"setAuthCookies\":false}" | bun run scripts/json-get.ts data.accessToken) || echo "login failed — stop"
[ -n "$TOKEN" ] && curl -s -X PATCH http://127.0.0.1:3000/api/admin/platform/flags -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"key\":\"matching.strict_service_capability\",\"enabled\":true,\"rolloutPct\":100,\"environment\":\"$FLAG_ENV\",\"description\":\"Phase 11 strict typed capability gate\",\"reason\":\"live closure step G\"}"
bun run scripts/live-closure-verify.ts --url "$DB_URL" --baseline "$BASELINE"
```

Read-back: "G strict flag" PASS (environment = what the backend reads, enabled, rollout 100, not a kill switch, written through the route with an actor and a reason, and F PASS) and "G runtime strict parity" PASS (the flag's own mode is STRICT and, on the next upcoming business bookings, every candidate gets exactly the same gate decision as a LEGACY preview). If it fails, switch it off the same way with `"enabled":false` and send the verifier output — never leave strict on with a different pool. A comparison over zero candidates is a FAIL by design: re-run when partners are online.

## C2. The two services with no content — BLOCKED

`spa` and `personal-hygiene-bathing-care` were published after the Phase 10 draft was written. Neither has execution, safety or quality content, and none can be invented: the method facts, prohibited conditions and quality checklist have to come from you (or the service is paused until they exist). Personal hygiene and bathing care for seniors is intimate personal care — its safety content needs real facts before partners are dispatched to it.

**Status 2026-09-29:** on your decision, both — and the six held services of step D — are **PAUSED** (09:10:30 UTC, `scripts/phase10-pause-unsupported-services.ts`, reason "Paused pending approved execution/safety/quality method facts.", one audit row each). Paused services are not offered and cannot be booked; existing bookings are untouched (spa has one upcoming paid booking — decide whether to honour or cancel it). The verifier's gate "P paused pending facts" lists them. To bring a service back: supply its method facts, apply them through step C / D, then set it ACTIVE from the admin catalogue.

## H. Duplicate-index migration (optional, performance — 2026-09-30)

`20260929200000_drop_redundant_duplicate_indexes` drops 14 plain btree indexes that duplicate a UNIQUE index on the same column (same opclass, collation, no predicate; no dependency, idx_scan 0 on live). Proven on a fresh replay of all 148 migrations (only those 14 `CREATE INDEX` lines differ; triggers 58, exclusions 2, functions 42, constraints 468, unique indexes 175 unchanged) and on a restore of `homigo_db_pre-closure-2_2026-09-29T09-01-17Z.dump` (1,028 → 1,014 indexes; idempotent; rollback in the file header restores 1,028; the planner uses the `_key` indexes). Each drop takes a lock for milliseconds.

```bash
# backend on :3000 stopped; a fresh dump first (as in step A)
bunx prisma migrate deploy        # applies only this pending migration (verifier "A migrations" names it)
```

Read-back: verifier "A migrations" PASS (148/148). Rollback: run the `CREATE INDEX` block from the migration's header.

## Done when

The verifier prints every gate PASS (on 2026-09-30 00:5x IST it printed 16 PASS · 1 PENDING — the pending item is step H). Paste the output into `docs/operations/evidence/phase10-11/live-closure-run.md` under "Owner run". Until then each step stays OWNER_APPROVAL_REQUIRED in the certification.
