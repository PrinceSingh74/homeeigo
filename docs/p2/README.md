# HOMIGO — P2 Operational Validation & Production Certification

Evidence-based validation suite. Audit-first, reuse-existing, build-only-missing.

## Reports

| Doc | Purpose |
|---|---|
| [`P2_AUDIT_REPORT.md`](./P2_AUDIT_REPORT.md) | Inventory of existing implementation (reused, not rebuilt) + gaps |
| [`P2_VALIDATION_REPORT.md`](./P2_VALIDATION_REPORT.md) | All 10 items: status + Evidence/Risk/Impact/Fix/Verification/Rollback/Success |
| [`P2_DR_RUNBOOK.md`](./P2_DR_RUNBOOK.md) | Disaster-recovery runbook + RTO/RPO targets + restore procedure |
| [`P2_PRODUCTION_READINESS_SCORECARD.md`](./P2_PRODUCTION_READINESS_SCORECARD.md) | Evidence-backed dimension scores |
| [`P2_EXECUTIVE_CERTIFICATION.md`](./P2_EXECUTIVE_CERTIFICATION.md) | Executive summary + Go/No-Go + sign-off checklist |
| [`evidence/`](./evidence/) | Machine-generated `.md` + `.json` evidence per validator |

## Validators (run from `apps/backend`)

| Command | Item | Infra needed |
|---|---|---|
| `bun run p2:grafana` | Grafana coverage | none (✅ verified: 100%) |
| `bun run p2:alerts` | Alert reliability | none (✅ verified: 9/9) |
| `bun run p2:dr` | DR restore drill | pg tools + scratch DB |
| `bun run p2:s3` | S3 backup validation | AWS creds + bucket |
| `bun run p2:sentry` | Sentry delivery | SENTRY_DSN |
| `bun run p2:wallet-integrity` | Wallet integrity | DB |
| `bun run p2:cluster` | Multi-node | Redis |
| `bun run p2:pentest` | Penetration test | running API (+creds) |
| `bun run k6:booking` / `k6:payment` / `k6:wallet` | Load tests | k6 + running API |

See `P2_VALIDATION_REPORT.md` → "How to certify everything COMPLETE" for the
single staging pass that turns every 🟡 PARTIAL into ✅ COMPLETED.
