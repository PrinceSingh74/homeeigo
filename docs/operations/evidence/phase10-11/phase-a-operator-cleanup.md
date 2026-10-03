# Phase A — operator / data cleanup (2026-09-24)

Every figure below was measured read-only on `homigo_db`. **No live row was written by this session.** Where a live change is needed, the exact command is given and marked OWNER_APPROVAL_REQUIRED.

## Live migration state (re-measured)

`_prisma_migrations` on homigo_db shows all five 2026-09-24 migrations applied: `20260924090000`, `120000`, `150000`, `180000` (§7/§8), and `200000` (§9). **OP-1, OP-5, OP-6, OP-7 and OP-8 are CLOSED**; the owner ran `migrate deploy`.

## A. The 3 open SOS incidents

`scripts/phase-a-stale-incidents.ts` is new. It runs in report mode by default and requires `--url`. It classifies each open incident from columns only:

| Incident | Opened | Verdict | Evidence |
|---|---|---|---|
| `cmta4vzb300fqtzqkb672hi9i` | 2026-08-26 | TEST_ARTEFACT | partner `partner@homigo.demo` matches `user.seed-domain`; opened through SOS; no booking linked |
| `cmtbx0s9700xytz840msun7m7` | 2026-08-27 | TEST_ARTEFACT | same partner; booking `S03L-s03live-mtbhd0x5` is CANCELLED_BY_PROVIDER and has a non-canonical number |
| `cmtkdxpbj07j4tzx8luixrbvx` | 2026-09-02 | TEST_ARTEFACT | same partner; booking `S03L-s03live-mtkdrsk8` is CANCELLED_BY_PROVIDER and has a non-canonical number |

**Origin:**
- `section03-seed-live-job.ts` created these; it was run against homigo_db with `dotenv/config`.
- The SOS came from `section05-live-cert.ts`, which calls `partnerSafetyService`.
- The linked customers are `live-customer-s03live-*@homigo.demo`.

**Why it matters:** open incidents gate START and COMPLETE under §9. Both linked bookings are terminal, so they block nothing now. They do sit in the safety queue as CRITICAL.

**Owner action (OWNER_APPROVAL_REQUIRED):** resolve them through the canonical admin path, which writes the activity log, the resolution note and the outbox event:
```
cd apps/backend && bun run scripts/phase-a-stale-incidents.ts --url "<homigo_db url>" --apply --actor <your admin userId>
```
You can also resolve them one by one in `/trust-safety/incidents`. The script refuses `--apply` without an active admin actor, and it never deletes anything.

## B. OP-3: the 4 stale bookings

Unchanged since the 2026-09-24 record in `owner-ops-2026-09-24.md`:

| Booking | Status | Payment |
|---|---|---|
| `…0612-00073` | ASSIGNED | PENDING |
| `…0615-00003` | EN_ROUTE | SUCCESS |
| `…0615-00012` | EN_ROUTE | SUCCESS |
| `…0824-00006` | ACCEPTED | SUCCESS |

- All four are 1–3 months past-dated.
- They cannot be re-matched, because no future slot exists and matching a past slot would fabricate a dispatch.
- Cancelling runs the real refund path; `.env` holds live Razorpay keys.
- **OWNER_APPROVAL_REQUIRED:** admin-cancel each one with the reason "stale test booking", or leave them.

## C. OP-4: `.demo` / UNKNOWN provenance

**New evidence-based rules** in `src/lib/data-provenance.ts`, tested in `data-provenance.test.ts`, 41/41 passing:

| Rule | Origin | Evidence |
|---|---|---|
| `user.seed-domain` | INFERRED_SYNTHETIC | This matches `@homigo.demo` exactly. That domain is hard-coded by the app's own seed and cert scripts, which are named in the rule, and `.demo` is undelegated. `acme.demo` and `demo.person@gmail.com` are **not** matched. |
| `booking.non-canonical-number` | INFERRED_TEST | Only `lib/booking-number.ts` mints booking numbers, and it mints only `HOMIGO-YYYYMMDD-NNNNN`. Any other format was written by a script. The rule is defined by the format, not by a list of prefixes. |

**Measured effect (report mode, nothing written):**
- 81 users would become INFERRED_SYNTHETIC. This includes `partner@homigo.demo` and the "Arjun" demo customer (173 bookings).
- 173 bookings would become INFERRED_TEST: `S03L` 83, `S07A` 15, `S07` 15, `S10F` 12, `S03C` 9, `S03` 9, `ADV` 6, `WPIC` 5, `S07C` 5, `XSYS` 3, `RC` 3, `P03` 3, `DBG` 2, `FM` 2, `P2VERIFY` 1.

**Why this is not applied:** it changes live matching. `partner@homigo.demo` would leave the business pool, so it would stop receiving the owner's own bookings. The owner may be using that for demos.

**OWNER_APPROVAL_REQUIRED:**
```
cd apps/backend && bun run scripts/provenance-report.ts --url "<homigo_db url>" --apply
```
This fills NULL values only and never overwrites or deletes.

The 42 "leans real" providers from `op4-unclassified-providers.md` stay UNKNOWN. The owner can declare them REAL.

## D/E. Fixture and demo scripts that wrote to live

**Root cause:** the cert and demo scripts load `.env` through `dotenv/config`, so they reach homigo_db by default.

**Control:** `scripts/lib/script-target.ts` is new and applies `requireDeclaredTarget()`:
- A test database is always allowed.
- Any other database needs `--allow-live` on the command line. No environment variable can grant it.
- The script announces its target before running.

**Scripts guarded:**
- `section03-lifecycle-api-cert`
- `section03-seed-live-job`
- `section05-live-cert`
- `e2e-demo-booking`
- `live-demo-create-booking`
- `live-demo-accept-booking`
- `live-demo-settle-payment`
- `section05-restore-demo-partner`
- `ensure-demo-partner`
- `ensure-demo-users`
- `section03-free-partner-capacity`

These scripts also now declare `dataOrigin` on the users and bookings they create: `CERTIFICATION`, or `FIXTURE` for demo users.

**Proof:**
- With a live URL and no flag, the script exits 2 with a REFUSING message.
- With a test URL, it proceeds.
- `check-provenance-declaration` passes (205 scripts), and `check-ddl-guard-coverage` passes.

## F. Analytics contamination

- The admin dashboard's average rating, online-partner count and 7-day booking/revenue charts had no scope. They now use `analyticsWhere` / `analyticsWhereVia`, the same population as every other tile.
- 16 intelligence services and the BigQuery ETL still have no provenance reference (listed in the discovery matrix). **TRACKED**: each needs its own scoped query review. The BigQuery ETL has been dead since 2026-08-19 (billing disabled), so it has no current effect.

## Status

| Item | Status |
|---|---|
| A. SOS incidents | OWNER_APPROVAL_REQUIRED (classified; one-command resolve through the canonical path) |
| B. OP-3 | OWNER_APPROVAL_REQUIRED |
| C. OP-4 / `.demo` | rules and test PASS; apply is OWNER_APPROVAL_REQUIRED |
| D/E. Live-writing scripts | PASS (guarded, provenance declared) |
| F. Dashboard contamination | PASS for the admin dashboard; intelligence services TRACKED |
