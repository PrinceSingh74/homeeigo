# PHASE 16 — MIGRATION SAFETY GUARD (FINAL)

## The incident this prevents

`prisma migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma`
on this repository produces ~300 lines, only a fraction of which are the objects the author
intended. The rest is accumulated drift, and it is destructive. Observed output includes:

```sql
ALTER TABLE "bookings" DROP COLUMN "provider_slot_end", DROP COLUMN "provider_slot_start",
                       DROP COLUMN "user_slot_end",     DROP COLUMN "user_slot_start";
DROP INDEX "users_email_key";
DROP INDEX "providers_pan_number_key";
ALTER TABLE "knowledge_chunks" DROP COLUMN "search_vector";
```

Those four booking columns back the half-open-range exclusion constraint added in
`20260909090000_booking_slot_half_open_ranges`. Dropping them **silently re-opens the
double-booking defect** — bookings simply start overlapping again, with no error anywhere.

An engineer who generates that diff and commits it has done the normal, documented thing. The
dangerous lines are buried among hundreds of legitimate ones. The check has to be mechanical.

## Implementation

`apps/backend/scripts/check-migration-safety.ts`, wired into the **prebuild gate**:

```
"prebuild": "bun run scripts/check-log-governance.ts && bun run scripts/check-migration-safety.ts"
```

Seven protected classes, chosen because losing them is **silent** — the system keeps running and
starts being wrong. Objects whose loss is loud (a table every request selects from) are deliberately
not listed; the application fails immediately and somebody notices.

| Class | Why silent loss is dangerous |
|---|---|
| `BOOKING_SLOT_EXCLUSION` | Overlaps resume with no error |
| `UNIQUE_IDENTITY` | Duplicate accounts and registrations are simply admitted |
| `FINANCE_LEDGER` | Unrecoverable — no second copy to reconstruct from |
| `AUDIT_TRAIL` | No request path breaks; the platform stops being able to answer questions about its past |
| `GOVERNANCE` | Flags and policy rows decide what may execute |
| `WORKFLOW_EVENTS` | Guaranteed delivery becomes best-effort, silently |
| `ML_REGISTRY` | Past inferences become unattributable |

## Three refinements the exercise forced

**Drop-and-recreate is a replacement, not a loss.** The first version refused
`20260909090000_booking_slot_half_open_ranges` — the very migration that *fixed* the double-booking
defect, which drops both exclusion constraints in order to recreate them with half-open ranges. A
guard that refuses the migration it is defending is one that gets overridden by reflex, and then the
next genuine drop sails through with it. Scoped to the **same file**: "some later migration recreates
it" is not the same guarantee, because between the two the constraint is absent.

**Match the object DROPPED, not any protected name in the statement.** The first version flagged
`ALTER TABLE "wallet_transactions" DROP CONSTRAINT "wallet_balance_consistency"` as "dropping
wallet_transactions" — simply false. The table is the subject; the constraint is the object. A guard
that reports things that are not happening gets dismissed.

**Scope to NEW migrations by default.** The repository contains genuine historical drops that were
correct when written (`20260609180000_p4_encryption_audit` drops `users_email_key` because it
replaces plain unique indexes with hash-based ones). Failing every build forever over migrations
that shipped months ago protects nothing. `--all` audits full history when someone wants that.

## Self-test

`scripts/phase16/migration-guard-selftest.ts` — **13 PASS / 0 FAIL**. A guard that has never been
observed failing is not a guard.

| # | Case | Expected |
|---|---|---|
| MG1 | The **real** `prisma migrate diff` output dropping booking slot columns | REFUSE |
| MG2 | Dropping a unique identity index | REFUSE |
| MG3 | Dropping the transactional outbox | REFUSE |
| MG4 | Dropping an audit table | REFUSE |
| MG5 | Dropping agent run history | REFUSE |
| MG6 | Dropping a ledger table | REFUSE |
| MG7 | Dropping a booking exclusion constraint without recreating it | REFUSE |
| MG8 | Drop-and-**recreate** of the same constraint | ACCEPT |
| MG9 | An ordinary additive migration | ACCEPT |
| MG10 | Dropping an **unprotected** table | ACCEPT |
| MG11 | Protected table as ALTER subject, unprotected constraint dropped | ACCEPT |
| MG12 | A short override (`"yes"`) | REFUSE |
| MG13 | A substantive override with a real explanation | ACCEPT |

Fixtures are written to a temp directory and deleted in a `finally` — a destructive migration
sitting in `prisma/migrations` is one `migrate deploy` away from being real, whatever the script
intended.

## Override

Refusal is the default. An override requires a **substantive** explanation of at least 20
characters, and is printed as `OVERRIDE ACCEPTED — this is recorded, not waived`:

```bash
MIGRATION_SAFETY_OVERRIDE="Outbox replaced by partitioned event_outbox_v2 in the same release; data migrated and verified."
```

MG12 proves a token override (`"yes"`) is refused. The bar exists so that overriding costs a
sentence of thought rather than a keystroke.

## Current state

```
[migration-safety] OK — 38 new/modified migration files scanned, no protected object is dropped
```

`--all` reports 6 historical drops across two migrations, all correct at the time and already
deployed. They are visible on demand rather than blocking every build.
