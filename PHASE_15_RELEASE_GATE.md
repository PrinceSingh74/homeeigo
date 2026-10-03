# PHASE 15 — Final Release Gate

# STATUS: `BLOCKED_AT_RELEASE_BOUNDARY — PRODUCTION_AUTHORIZATION_ABSENT`

Not `PHASE_15_PRODUCTION_LIVE`. The blocker is named exactly, and it is not code.

**All twelve gate items were re-measured for this document. Nothing below is recalled.**

---

## A. The twelve gate checks

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | Production runtime exists | **NO** | 0 application ports listening |
| 2 | Production HTTP server exists | **NO** | `/health` on 3000/3001/3002/4000/8080 → no response |
| 3 | Production workers exist | **NO** | and see §B — there is no separate worker to deploy |
| 4 | Production scheduler exists | **NO** | in-process only; no process is running |
| 5 | Production event processing exists | **NO** | in-process only; no process is running |
| 6 | Feature flags exist and are configured | **PARTIAL** | table present; **2 flags, both `environment='dev'`, both disabled**. Zero production flags |
| 7 | Production authorization exists | **NO** | 0 env vars, 0 authorization files, 0 codebase convention |
| 8 | Migration state is known | **YES** | 97 applied, 3 rolled back, 100 ledger rows; 11 pending on disk |
| 9 | Schema matches the intended release | **NO** | 203 tables in production vs **212** on the migrated clone |
| 10 | Production model registry exists | **NO** | `ml_model_versions` ABSENT |
| 11 | Production AI budget infrastructure exists | **NO** | `ai_budget_policies`, `ai_budget_windows`, `ai_workflow_drafts` all ABSENT |
| 12 | Production audit trace behaviour is correct | **NO** | see below — proven from data, not schema |

### Item 12, proven from the data itself

```sql
SELECT max(c) FROM (SELECT count(*) c FROM enterprise_audit_logs
                    WHERE trace_id IS NOT NULL GROUP BY trace_id) t;
-- 1
```

Across **353,220 audit rows, no trace has ever held more than one event.** That is the unique index
doing exactly what the Phase-14 finding said it does: an approval and the promotion it authorises
share a trace, and only one of them can ever be stored. This is the runtime consequence, not an
inference from the schema.

The migration that fixes it (`20260907090100_audit_trace_not_unique`) is rehearsed and pending.

---

## B. An architectural fact the gate list assumes otherwise

Items 3, 4 and 5 ask about workers, scheduler and event processing as if they were separate
deployables. **They are not.** There is no worker entrypoint: `startScheduledJobProcessor()` is
called from `lib/maintenance.ts`, which the single `src/index.ts` process boots, and the Dockerfile's
only command is `bun run src/index.ts`.

Confirmed during the clone rehearsal — one process brought up the HTTP server, the scheduled-job
processor, the event consumers and the workflow engine together.

**Consequence for release:** there is one deployable unit, not four. Items 3–5 succeed or fail with
item 1. That removes any "did the workers start?" ambiguity — and it also means one process failure
takes all four down at once.

---

## C. Recovery path — verified today, not assumed

This matters more than usual here, because two of the twelve pending migrations are one-way (§E) and
restore-from-backup is their **only** real recovery.

```
Fresh backup of homigo_db
  52.07 MB, 32.9 s
  SHA256 3b4a98ff4874e3c97685bd8bc5d32eb45f9e37f711da8708c22f75214b3dd3ef
  pg_restore --list integrity: verified
  uploaded to s3://homigo-prod-backups-prince (eu-north-1, SSE AES256)
  GFS retention: kept 4, pruned 0

Restore drill into homigo_dr_scratch (production untouched)
  SHA256 verified · archive integrity verified
  row counts: users=870, bookings=670
  RTO = 25.64 s
  PASS
```

**A gate finding:** before this run, the newest backup was from **2026-08-25 — eleven days old**, and
predated both the current production state and the 2026-09-05 contamination. A recovery plan resting
on it would have restored to a state missing eleven days of real activity. The backup above is
current.

---

## D. Production data incident

# CLASSIFICATION: `REQUIRES_AUTHORIZED_CLEANUP`

With a live financial exposure that earlier reports did not identify.

### What is actually there

```
231 fixture bookings   (services named 'Adv Service adv-%', 2026-06-09 → 2026-09-05)
110 payments           ₹58,333
 14 earnings           ₹6,286.40, all CREDITED
  4 wallet transactions
 28 activity logs
```

### The decisive question: did real money leave?

**No.** The 5 providers holding fixture earnings have 44 withdrawals between them —
**43 REQUESTED, 1 APPROVED, 0 COMPLETED.** Nothing has been paid out.

### But two wallets are 100% fixture

| Provider | Fixture credit | Wallet balance | Share |
|---|---|---|---|
| `cmq6ukegr0005tzoczxey43xt` | ₹400.00 | **₹400.00** | **100%** |
| `cmtonp9sn021rtz38kovza7jd` | ₹506.40 | **₹506.40** | **100%** |
| `cmq9h687s0005tz8swhtkju1p` | ₹2,740.00 | ₹63,052.00 | 4% |
| `cmq6b0iue0001tzbo5fnp9t5q` | ₹2,200.00 | ₹15,470.40 | 14% |
| `cmrfxj1fm02aitz78sm9depfw` | ₹440.00 | ₹8,412.00 | 5% |

**Two providers hold a wallet balance that exists only because test data was written into
production.** If either requests a withdrawal, the platform pays out money nobody earned. One of
those two (`cmtonp9sn...`) was created by the 2026-09-05 incident; the other predates it.

### And one approved withdrawal sits on an inflated balance

```
withdrawal cmqjx236v0a4jtzvk2fzdtpdg   ₹10,008
  provider wallet ₹63,052, of which ₹2,740 is fixture-credited
  status APPROVED — one step from payout
```

The payout is covered by real balance (₹10,008 < ₹60,312 genuine), so this is not an imminent loss.
It is recorded because it is the closest thing to one, and because approving payouts against balances
of unknown provenance is the mechanism by which it would become one.

### Why nothing was deleted

No authorization mechanism exists. Deleting production rows without one is the action the standing
instruction forbids, and that I created 141 of these rows by mistake does not authorize their
removal.

**Production must not be called clean.** Fixture data is roughly **34% of all bookings** (231 of 670)
and ₹6,286.40 of provider wallet balance is fixture-derived. That is a standing, unresolved condition
awaiting an authorized owner's decision.

### The part that is not an engineering decision

Removing an earning that has already moved a provider's wallet balance requires either a compensating
adjustment or a decision that the balance was never real. Whoever owns the ledger has to make that
call. Everything up to it is prepared.

---

## E. Rollback — five mechanisms, stated without overpromising

| Mechanism | Available? | Reality |
|---|---|---|
| **Backup restore** | **YES — verified today** | RTO 25.64 s on a 52 MB dump. The only true recovery for the one-way migrations |
| **Forward-fix** | YES | The required path for migrations #8 and #12 |
| **Feature rollback** | **NOT USABLE YET** | The flag architecture exists, but production holds 2 flags, both `dev`, both off. Nothing to roll back until production flags are created |
| **Model rollback** | **NOT PRESENT** | `ml_model_versions` is absent from production. The lifecycle (including ROLLBACK) exists in code and is exercised in tests; it has no production table to act on |
| **Workflow rollback** | YES | `workflow_definitions` is versioned in production (25 definitions, 14 active); a definition can be reverted to a prior version |

### The two migrations that cannot be rolled back

- `20260907090100_audit_trace_not_unique` — re-creating the unique index fails the moment a second
  audit row shares a trace, which is the entire point of the change.
- `20260909090000_booking_slot_half_open_ranges` — reverting to closed ranges fails if any two
  bookings now touch at a boundary, which is exactly what the change permits.

Neither destroys data. Both enable states that are legal afterwards and illegal before — a harder
kind of irreversibility than data loss, and an easier one to overlook. **Do not plan around rolling
these back.** Plan around the verified restore in §C.

---

## F. Deployment artifacts — what exists, what is missing

| Artifact | State |
|---|---|
| `apps/backend/Dockerfile` | Ready — 3-stage build, `EXPOSE 8080`, `HEALTHCHECK` every 30 s, `CMD bun run src/index.ts` |
| `deploy/cloud-run/service.yaml` | Ready — minScale 1, maxScale 50, 1 CPU / 1 Gi, containerPort 8080. **Placeholders `REGION` / `PROJECT_ID` must be filled** |
| `apps/backend/deploy/homigo-backend.service` | Ready — systemd alternative, SIGTERM drain, 10 s grace, restart-always |
| Migration set | Rehearsed: 12 migrations, exit 0, 28,306 ms, zero data loss |
| Verified backup | **Taken today**, restore drill PASS |
| **Production feature flags** | **MISSING — must be created before any Phase-15 rollout** |
| **Production authorization** | **MISSING — the blocker** |

---

## G. The exact sequence, when authorized

Nothing here is speculative; every step has been rehearsed or verified except those that require
production itself.

1. Grant production authorization through a real mechanism.
2. Take a fresh backup and **re-run the restore drill** — today's proves the path, not tomorrow's data.
3. Re-clone production, re-run `prisma migrate deploy`, re-time it. The 28 s figure is proportional to
   `bookings` size and will age.
4. Apply the 12 migrations. Schedule #12 in a maintenance window — it rebuilds two GiST indexes under
   ACCESS EXCLUSIVE on `bookings`.
5. Verify with direct SQL, not logs: 109 applied, audit rows unchanged, `trace_id` no longer unique,
   slot ranges `'[)'`, `ml_model_versions` / `ai_budget_*` / `ai_workflow_drafts` present.
6. Build and deploy the image; start the single runtime (HTTP + scheduler + events + workflows).
7. Verify `/health` and `/ready` respond, and that the scheduled-job processor and event consumers
   log their start.
8. **Create production feature flags**, all disabled. Then enable only approved ones, one at a time.
9. Canary on a controlled cohort; verify latency, errors, AI cost, budget denials, audit writes,
   RBAC, model governance, event processing.
10. Resolve the data incident (§D) with an authorized owner before treating production figures as
    trustworthy.
11. Expand only on evidence.

---

## H. Why the status is not `PHASE_15_PRODUCTION_LIVE`

That status requires runtime, workers, scheduler, applied migrations, active flags, reachable routes,
working RBAC/governance/audit/budget/observability, a successful canary, a verified rollback path,
and **verified real production traffic**.

Of those, the verified rollback path is the only one now satisfied. The rest are blocked behind three
things that cannot be produced from this side:

**authorization, a deployed runtime, and production feature flags.**

Manufacturing any of the three — inventing an authorization token, calling the clone a runtime, or
flipping the two `dev` flags to `production` to pass the gate — would satisfy the checklist and
destroy the point of it.
