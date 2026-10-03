# PHASE 15 — Release Guard Validation

# STATUS: `RELEASE_BLOCKED_AUTHORIZATION` → then `RELEASE_BLOCKED_TARGET_BILLING`

The release gate is now **validated by attack, not by inspection**: 21 invalid or degraded inputs
were fed to it and every one was refused, and the one valid configuration passed. A gate that has
never refused anything is a decoration.

---

## A. The five decision gates, re-measured

| Gate | Measured | State |
|---|---|---|
| A. Authorization | 0 files, 0 env vars, GitHub environments = `staging` only | **ABSENT** |
| B. Runtime target | Cloud Run services: **0**; listening ports: **0** | **UNDECIDED / NOT PROVISIONED** |
| C. Database target | Cloud SQL instances: **2, both `homigo-staging-*`, both SUSPENDED** | **NO PRODUCTION INSTANCE** |
| D. Ledger decision | no decision recorded | **ABSENT** |
| E. GCP billing | `billingEnabled: false`, `billingAccountName: ''` | **DISABLED** |

**Correction to my previous report.** I earlier reported "Cloud SQL instances: 0". That was wrong —
the query had failed silently behind the billing error. There are **two**, both staging-scoped and
both `SUSPENDED`. The conclusion is unchanged (no production database exists) but the earlier
number was.

---

## B. Authorization — 12 invalid forms, all refused

Every case ran the real script against a real file. None were reasoned about.

| Case | Result |
|---|---|
| missing authorization file | `RELEASE_BLOCKED_AUTHORIZATION` |
| paraphrased statement (`"I authorize this release."`) | refused |
| statement uppercased | refused |
| statement padded with whitespace | refused |
| statement truncated to 30 chars | refused |
| expired (25 h old) | refused |
| timestamp in the future | refused |
| unparseable timestamp (`"yesterday"`) | refused |
| empty signer identity | refused |
| `target: "cloudrun"` (near-miss enum) | refused |
| `ledgerReconciliation: "accepted"` (near-miss enum) | refused |
| empty `approvedMigrations` | refused |

**12 / 12 refused.**

Enum near-misses are refused rather than normalised. `"cloudrun"` is not silently read as
`CLOUD_RUN`, and `"accepted"` is not read as `EXPLICITLY_ACCEPTED` — the point of those fields is
that a person chose one option deliberately, and repairing a typo would be deciding on their behalf.

---

## C. Migration binding — proven in both directions

The first version of this gate had a real hole: it checked that every **approved** migration exists
on disk, but not that every migration that **would actually run** is approved. An authorization
signed for twelve migrations would have silently applied a thirteenth that landed afterwards.

Now the check computes `pending = on-disk − applied-in-target` and requires it to equal the approved
list **exactly**.

| Case | Result |
|---|---|
| One pending migration missing from the approved list | `FAIL: 1 migration(s) would be applied that the authorization does not cover: 20260909090000_booking_slot_half_open_ranges` |
| Approved list names a migration absent from disk | `FAIL: authorization names migrations absent from disk: 29990101000000_ghost` |
| Exact match | `PASS: pending set matches the authorization exactly (12 migrations)` |

**These three had to be re-run with a `VM_SYSTEMD` target.** On the first attempt they were refused
by the billing gate before the migration check ran — refused for the wrong reason, which proves
nothing about the migration binding. Re-running against a target that skips billing was the only
way to see the check actually fire.

---

## D. Backup gate — four states, including the positive one

| Case | Result |
|---|---|
| Fresh backup, valid sha256 | **PASS** — `0.0h old, sha256 verified`, script exit **0** |
| Corrupted sha256 sidecar | `RELEASE_BLOCKED_BACKUP` — *"the archive is not what was recorded"* |
| Sidecar restored | PASS again |
| Sidecar missing entirely | `RELEASE_BLOCKED_BACKUP` — *"integrity cannot be verified"* |
| Backup older than 6 h | `RELEASE_BLOCKED_BACKUP` (observed earlier at 8.9 h) |

The corrupted sidecar was restored immediately and re-verified: `sha256 OK`.

**The positive case matters most.** With a valid authorization, a `VM_SYSTEMD` target and a fresh
backup, the gate returned **exit 0, all checks passed**. It is not a gate that always says no — it
says no to specific, real conditions, and yes when they are met.

---

## E. What the gate now enforces

| Control | Enforcement |
|---|---|
| Authorization file | Must exist, parse, and carry all 8 fields |
| Statement | Byte-exact match — no case, whitespace or paraphrase tolerance |
| Expiry | 24 hours, and refuses future timestamps |
| Signer | Must be named |
| Target enum | `CLOUD_RUN` \| `VM_SYSTEMD`, exact |
| Ledger decision | `RECONCILED` \| `EXPLICITLY_ACCEPTED`, exact, with a named decider |
| Billing | Required only for `CLOUD_RUN`; read live from `gcloud` |
| Database target | A `CLOUD_RUN` target pointed at `localhost` is refused — a cloud runtime cannot reach a workstation's Docker Postgres, and the failure would otherwise look like a successful deploy until the first request |
| Backup | ≤ 6 h old, sha256 sidecar present and matching |
| Migrations | Pending set must equal the approved set exactly |

It cannot authorize itself. There is no flag, environment variable or argument that proceeds without
the file.

---

## F. Precise blocker names

```
RELEASE_BLOCKED_AUTHORIZATION        missing / malformed / expired / paraphrased
RELEASE_BLOCKED_TARGET_BILLING       billing disabled on the cloud project
RELEASE_BLOCKED_DATABASE_TARGET      DATABASE_URL disagrees with the authorized target
RELEASE_BLOCKED_DATA_RECONCILIATION  ledger decision absent or invalid
RELEASE_BLOCKED_BACKUP               stale, unverifiable or corrupt backup
RELEASE_BLOCKED_MIGRATION_MISMATCH   pending set differs from the approved set
```

---

## G. One implementation note worth recording

While hardening this file, a Python heredoc mangled `err.message.split("\n")` into a literal newline,
producing an unterminated string that broke the script. It was caught because the script was **run**
after editing rather than only typechecked at the file level.

This is the fourth time in this project that escape-mangling has silently corrupted generated code.
The rule that catches it every time is the same: **run the thing you just edited.**

---

## H. Current state

```
authorization file : absent (only .production-authorization.example.json)
backup             : homigo_2026-09-06T04-23-13-300Z.dump, sha256 verified
production         : 97 migrations, 670 bookings, 353,220 audit rows — unchanged
```

No new production mutation was performed during this release-readiness pass. Previously identified
fixture/test contamination remains subject to authorized reconciliation.
