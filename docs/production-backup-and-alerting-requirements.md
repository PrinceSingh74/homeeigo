# Production backup / PITR and external alert delivery — BLOCKED

Status: **BLOCKED — NO PRODUCTION INFRASTRUCTURE OR CREDENTIALS.** Both gates stay BLOCKED. Local
rehearsals prove the *logic*; they prove nothing about production.

---

## Phase 11 — Backup and point-in-time recovery

### What is proven (local only)
- `pg_dump` of `homigo_db` → restore into a scratch database: **216/216 tables identical row counts**,
  ledger/wallet/payment totals identical, triggers, functions, indexes, constraints and migration
  counts identical, schema-drift clean. Dump 6 s / restore 11 s, 65 MB, sha256 recorded.
- A second, narrower rehearsal was done for the dev migration in this pass: backup → clone → apply →
  verify → only then apply to dev.
- Code exists and runs: `scripts/backup-db.ts` (pg_dump + optional S3 upload),
  `scripts/restore-postgres.ts`, `scripts/verify-backup-restore.ts` (scratch-DB drill),
  `scripts/apply-backup-retention.ts`, and a scheduled backup job in `lib/maintenance.ts` behind the
  distributed leader lock.

### What is NOT proven, and why it stays BLOCKED
| Requirement | State | What the owner must provide |
|---|---|---|
| Backup schedule running in production | unverified | a deployed runtime; evidence of consecutive successful runs |
| Off-host storage | **not configured** — `AWS_S3_BUCKET` / `AWS_DEFAULT_REGION` unset, so backups stay local | bucket + region + credentials |
| Encryption at rest / in transit | unverified | bucket policy (SSE), TLS endpoints |
| Access control | unverified | who may read/restore backups |
| Retention | script exists, never run against production | retention period decision (`BACKUP_RETENTION_DAYS` is 14 in dev) |
| **PITR / WAL archiving** | **absent** — dumps are point-in-time snapshots only | WAL archiving (or a managed Postgres with PITR) |
| Restore credentials + owner | undefined | named owner and a break-glass procedure |
| RPO / RTO | undefined | targets; today's snapshot-only design implies RPO = backup interval |
| Production-style restore drill | not performed | a production-shaped environment to restore into |

**Do not mark this PASS on the strength of the local rehearsal.** A dump/restore on one laptop with
65 MB of dev data says nothing about production volume, storage durability or recovery time.

---

## Phase 12 — External alert delivery

### What is proven
- The **internal** pipeline works end to end: Prometheus rules → Alertmanager. A genuine
  target-down condition fired and the alert is active in Alertmanager (verified live).
- `monitoring/alertmanager.yml` has the full routing tree: P0 → escalation (0 s group wait, 15 min
  repeat), P1 → critical, P2 → warning, P3 → info, each with a webhook back into
  `/api/admin/observability/alerts/evaluate`, plus Slack, email and PagerDuty receivers.
- Payload shape and dedupe/grouping (`group_by`, `repeat_interval`) are configured per severity.

### What is NOT proven
| Requirement | State | What the owner must provide |
|---|---|---|
| Slack delivery | **BLOCKED** | `SLACK_WEBHOOK_URL` |
| Email delivery | **BLOCKED** | `SMTP_SMARTHOST`, `SMTP_USERNAME`, `SMTP_PASSWORD` |
| Pager delivery | **BLOCKED** | PagerDuty routing key |
| Sentry delivery | **BLOCKED** | a production DSN owned by the deployment (see the isolation note below) |
| On-call rotation | undefined | who receives P0 at 03:00 |

### Isolation — fixed in this pass
A test runtime can no longer reach any external destination, so it cannot raise an alert that lands
in production monitoring or pollute the production Sentry project:
- Sentry is disabled whenever `NODE_ENV=test` unless `HOMIGO_REQUIRE_SENTRY=1`
  (`lib/observability.ts`), closing the `sentry-chaos-pollution` class of incident.
- Twilio, Google Maps, BigQuery, OpenWeather, Razorpay, Resend, Expo push, S3 and the AI providers
  are all gated by `lib/test-egress.ts`.
- A second layer (`src/__tests__/helpers/no-external-egress.ts`, loaded as a bunfig preload) blocks
  any non-loopback socket from a test process regardless of the client library.
- Proven by `egress-barrier-enforced.test.ts` (10 cases) and by a netstat witness over full suites:
  **0 external connections**.

### PII in alerts
Alert payloads carry identifiers, not personal data, and the log redactor now masks phone numbers in
every shape while leaving UUIDs, booking numbers and timestamps intact
(`phase14-governance.test.ts`, 4 cases).

**Owner:** infrastructure / SRE. Until the credentials and the deployed runtime exist, both phases
remain BLOCKED and are reported as such.
