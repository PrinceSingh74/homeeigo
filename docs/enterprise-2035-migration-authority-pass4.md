# HOMEEIGO — Migration authority, Pass 4

**MIG-6 (P1, OPEN — blocked on one operator command): the generated Prisma client cannot read
`users`, `bookings` or `refund_requests` from `homigo_db`.**

**MIG-7 (P2, FIXED): the script that exists to catch exactly that reported 29/29 PASS while it was
true.**

---

## 1. MIG-6 — the client and the database disagree

`prisma/schema.prisma` declares `dataOrigin` on three models and the client was regenerated from it.
The migration that adds the column has **never been applied to `homigo_db`**:

```
tables with data_origin: (none)
DataOrigin enum: (missing)
relevant migrations in _prisma_migrations: (none)
```

So the client selects a column the database does not have:

```
  FAIL  user.findFirst()           code=P2022
  FAIL  booking.findFirst()        code=P2022
  FAIL  refundRequest.findFirst()  code=P2022
  FAIL  booking.findMany({take:1}) code=P2022
  OK    user.findFirst({ select: { id: true } })
  OK    booking.count()
```

The pattern is what makes this dangerous. An **explicit `select`** asks Postgres only for the columns
it names, so it works. A **bare find** selects every scalar the client believes exists, so it throws.
Most application code does bare finds.

**The running backend survives only because it holds a client generated before the schema changed.**
It serves `/metrics`, it answers `/ready`, `database_up` reports 1 — and a restart breaks login,
bookings and refunds. Nothing in the health surface says so, because nothing in the health surface
does a bare find.

This is the defect this session introduced: the schema change and the migration were authored, the
client was regenerated, the migration was not applied.

### Pending

```
PENDING (in repo, never applied):
   20260921090000_schema_drift_repair
   20260921100000_autovacuum_high_churn_tables
   20260921120000_data_provenance
```

All three were authored and reviewed this session.

### What applying them actually does — measured, not assumed

| Migration | Statements | Work against the current database |
|---|---|---|
| `schema_drift_repair` | 24 DDL, **all** `IF [NOT] EXISTS` | 4 `DROP INDEX` are **verified no-ops** (those indexes are already absent); of 20 indexes, **15 already exist**, so **5 are created** |
| `autovacuum_high_churn_tables` | 8 `ALTER TABLE ... SET` | storage parameters only; idempotent |
| `data_provenance` | 1 `CREATE TYPE`, 3 `ADD COLUMN IF NOT EXISTS` (nullable), 3 `COMMENT` | adds the column; no data is written or moved |

The five indexes that would be created, and the size of what they index:

```
addresses_address_payload_hash_idx            addresses        352 kB
enterprise_audit_log_archives_original_log_id_idx   (archives)  32 kB
idx_bookings_status_created                   bookings       1,304 kB
idx_bookings_user_scheduled                   bookings       1,304 kB
idx_payments_user_status_created              payments         696 kB
```

Roughly 5 MB of index writes on tables of at most 1.4 MB. Not a maintenance window.

`CREATE TYPE` is the one statement that is not re-runnable — Postgres has no `IF NOT EXISTS` for it —
which is correct for a migration that runs once, and the enum is verified absent.

### Migration history is not blocking

Four rows are unfinished or rolled back:

| Migration | State |
|---|---|
| `20260816120000_automation_workflow_engine` | failed, `rolled_back_at` set |
| `20260817090000_notification_delivery_claim` | finished, then `rolled_back_at` set; no directory (rename residue) |
| `20260817100000_notification_platform` | failed, `rolled_back_at` set |
| `20260825140000_audit_log_action_created_at_index` | failed, `rolled_back_at` set |

Prisma blocks on `finished_at IS NULL AND rolled_back_at IS NULL`. All four have `rolled_back_at`, so
`migrate deploy` is not blocked by them. They remain untidy history and are unchanged here.

### OPERATOR_ACTION

```bash
cd apps/backend && bunx prisma migrate deploy
```

**Not performed.** The command is refused in this environment as a production deploy, and working
around that refusal is not something to do on someone else's database. Verify afterwards with:

```bash
DBURL=$(grep -m1 '^DATABASE_URL=' .env | sed 's/^DATABASE_URL=//' | tr -d '"'"'"'\r')
bun run scripts/verify-migration-authority.ts --url "$DBURL"   # must print 29/29
```

Everything DQ-7 delivers is verified against `homigo_test`, which has the column. None of it takes
effect on the live database until this runs.

---

## 2. MIG-7 — the verifier could not fail

`scripts/verify-migration-authority.ts` printed **29/29 checks passed** against the database
described above. Two of its checks were structurally incapable of failing.

### 2a. The client probes used narrow selects

```ts
["user", () => prisma.user.findMany({ take: 1, select: { id: true, emailHash: true, walletBalance: true } })],
```

A narrow `select` asks only for the columns it names, so a column the client declares and the
database lacks is never requested and never errors. The probe reported `ok` for `user`, `booking`
**and** `refundRequest` — all three of which the client could not read.

The check's own comment said it existed because "a column the client expects and the schema lacks
throws rather than returning a wrong answer". It was right about the mechanism and then wrote a query
that avoids triggering it.

**Fixed:** `prisma.<model>.findMany({ take: 1 })`. A bare find selects every scalar the client
believes exists, which is exactly the claim being tested.

### 2b. The migration-directory check could only see directories that had a row

```ts
const unclean = await prisma.$queryRawUnsafe(`SELECT migration_name FROM _prisma_migrations ...`);
const missingDdl = unclean.filter((r) => onDisk.has(r.migration_name));
record(missingDdl.length === 0, `every migration directory has a clean applied row (...)`);
```

`unclean` is derived from **rows**. Intersecting it with the directory listing can only ever surface
directories that already have a row. A directory with **no row at all** — never applied, the plainest
possible form of the thing the check is named after — was invisible. Three of them sat under it and
it printed `(0 without one)`.

**Fixed:** the set of directories with no row is computed directly and reported by name.

Two smaller fixes fell out: the listing counted `migration_lock.toml` as a migration, and the failure
message printed `(e as Error).message.split("\n")[0]`, which is the empty string for every Prisma
error, so a failure named the model and gave no reason.

### After

```
 FAIL  client query user: P2022 Invalid `prisma.user.findMany()` invocation:
 FAIL  client query booking: P2022 ...
 FAIL  client query refundRequest: P2022 ...
 FAIL  every migration directory has a clean applied row (0 unclean, 3 never applied:
       20260921090000_schema_drift_repair, 20260921100000_autovacuum_high_churn_tables,
       20260921120000_data_provenance)

[migration-authority] 25/29 checks passed on "homigo_db".
```

25/29 is the honest number. It will return to 29/29 when the operator command above runs — and if it
does not, the verifier will now say so.

---

## 3. The general lesson

Both MIG-7 defects share a shape with the observability defects found in the same pass: a check that
runs, reports healthy, and cannot express the failure it was built for.

- 114 alert rules, all `health=ok`, scraping a port nothing listens on.
- `DatabaseDown` keyed to a target that was down on every scrape regardless of the database.
- A migration verifier whose client probes avoided the columns that drift.
- A directory check that could only see directories it already knew about.

None of these would be caught by asking "does the check pass?". They are caught by asking "can this
check fail, and what exactly would make it?" — which is why every fix in this pass was reintroduced
deliberately and the check watched to fail before being restored.
