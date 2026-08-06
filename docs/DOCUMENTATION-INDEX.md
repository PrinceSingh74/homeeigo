# HOMIGO Enterprise Documentation Index

**Document ID:** `DOC-INDEX-001`  
**Last Updated:** 2026-08-06  
**Certified RC:** `c31f154a128022fa7d9c4e44652506eedf3fa3e4`  
**Program Status:** Phase 0 — **CLOSED** (Staging Certified · Production NOT DEPLOYED)

---

## Start Here

| Audience | Entry Document |
|----------|----------------|
| **CEO / Board** | [Executive Handover](./executive/EXECUTIVE-HANDOVER.md) |
| **CTO / CAB** | [Production Go/No-Go Board Pack](./governance/PRODUCTION-GO-NOGO-BOARD-PACK.md) |
| **Engineering** | [Developer Onboarding](./knowledge-transfer/DEVELOPER-ONBOARDING.md) |
| **SRE / Operations** | [Enterprise Operations Handbook](./operations/ENTERPRISE-OPERATIONS-HANDBOOK.md) |
| **Architecture Review** | [Enterprise System Blueprint](./architecture/HOMIGO-ENTERPRISE-SYSTEM-BLUEPRINT.md) |
| **Audit / Compliance** | [Final Certification Report](./final-certification/PHASE-0-FINAL-CERTIFICATION-REPORT.md) |

---

## Architecture

| Document | Description |
|----------|-------------|
| [HOMIGO Enterprise System Blueprint](./architecture/HOMIGO-ENTERPRISE-SYSTEM-BLUEPRINT.md) | Complete platform architecture |
| [Master Traceability Matrix](./architecture/MASTER-TRACEABILITY-MATRIX.md) | ADR → evidence → runbook mapping |
| [HOMIGO Radar v1 Specification](./architecture/homigo-radar-v1.md) | Operations UI spec (deferred) |
| [OpenTelemetry Gap Analysis](./architecture/opentelemetry-gap-analysis.md) | OTel export gap (deferred) |
| [Historical Staging Observability ADR](./architecture/adr-001-staging-observability-platform.md) | Superseded by ADR-008 |

---

## Architecture Decision Records (ADRs)

| Document | Description |
|----------|-------------|
| [**ADR Index**](./architecture/ADR-INDEX.md) | Master ADR catalog |
| [ADR-001 Transactional Outbox](./architecture/adr-001-transactional-outbox-pattern.md) | Outbox pattern |
| [ADR-002 Event Driven Architecture](./architecture/adr-002-event-driven-architecture.md) | Domain events |
| [ADR-003 Leader Election + SKIP LOCKED](./architecture/adr-003-leader-election-skip-locked.md) | Multi-instance processing |
| [ADR-004 Retry Strategy](./architecture/adr-004-retry-strategy.md) | Hybrid retry |
| [ADR-005 Dead Letter Queue](./architecture/adr-005-dead-letter-queue-strategy.md) | DLQ + replay |
| [ADR-006 Idempotency Strategy](./architecture/adr-006-idempotency-strategy.md) | Exactly-once effects |
| [ADR-007 Payment Financial Atomicity](./architecture/adr-007-payment-financial-atomicity.md) | Razorpay TEST cert |
| [ADR-008 Observability Architecture](./architecture/adr-008-observability-architecture.md) | Prom/Grafana/AM |
| [ADR-009 Alerting Strategy](./architecture/adr-009-alerting-strategy.md) | Alert rules |
| [ADR-010 Deployment Strategy](./architecture/adr-010-deployment-strategy.md) | Digest-pinned deploy |
| [ADR-011 Staging Certification Strategy](./architecture/adr-011-staging-certification-strategy.md) | Stages C–G |
| [ADR-012 Production Promotion Strategy](./architecture/adr-012-production-promotion-strategy.md) | Prod promotion gates |

---

## Certification (Final Dossier)

| Document | Description |
|----------|-------------|
| [Phase 0 Final Certification Report](./final-certification/PHASE-0-FINAL-CERTIFICATION-REPORT.md) | Authoritative 15-section dossier |
| [Executive Summary](./final-certification/PHASE-0-EXECUTIVE-SUMMARY.md) | Stakeholder summaries |
| [Enterprise Sign-Off](./final-certification/PHASE-0-SIGNOFF.md) | Formal sign-off page |
| [Risk Register](./final-certification/PHASE-0-RISK-REGISTER.md) | Accepted/deferred/residual risks |
| [Production Readiness Checklist](./final-certification/PHASE-0-PRODUCTION-READINESS-CHECKLIST.md) | 121 gate checklist |
| [Evidence Index](./final-certification/PHASE-0-EVIDENCE-INDEX.md) | 237 artifact catalog |

---

## Evidence (Runtime Proof)

| Location | Description |
|----------|-------------|
| [`docs/evidence/`](./evidence/) | **237 preserved runtime artifacts** |
| Stage C | `docs/evidence/stage-c-step-{4,5,6,6a-6d,7}/` |
| Stage D | `docs/evidence/stage-d/`, `stage-d-step-{8-12}/` |
| Stage E | `docs/evidence/stage-e-step-{13-16}/` |
| Stage F | `docs/evidence/stage-f-remediation/`, `stage-f-step-{17,18}/` |
| Stage G | `docs/evidence/stage-g-soak/` |

---

## Operations

| Document | Description |
|----------|-------------|
| [Enterprise Operations Handbook](./operations/ENTERPRISE-OPERATIONS-HANDBOOK.md) | Daily/weekly/monthly SOPs |
| [Production Promotion Runbook](./operations/PRODUCTION-PROMOTION-RUNBOOK.md) | Production deploy procedure |
| [Rollback Runbook](./operations/ROLLBACK-RUNBOOK.md) | Rollback decision tree |
| [Database Restore Runbook](./runbooks/database-restore.md) | PITR and clone procedures |
| [Stage D Runbook (reference)](./evidence/stage-d/stage-d-runbook.md) | Staging certification flow |

---

## Release

| Document | Description |
|----------|-------------|
| [Release Notes RC c31f154](./release/RELEASE-NOTES-RC-c31f154.md) | Enterprise release notes |

---

## Governance

| Document | Description |
|----------|-------------|
| [Production Go/No-Go Board Pack](./governance/PRODUCTION-GO-NOGO-BOARD-PACK.md) | CAB board pack |
| [Documentation Completion Report](./governance/DOCUMENTATION-COMPLETION-REPORT.md) | Package closure report |

---

## Executive

| Document | Description |
|----------|-------------|
| [Executive Handover](./executive/EXECUTIVE-HANDOVER.md) | CEO/CTO/investor handover |

---

## Knowledge Transfer

| Document | Description |
|----------|-------------|
| [Developer Onboarding](./knowledge-transfer/DEVELOPER-ONBOARDING.md) | Engineering onboarding guide |

---

## Observability (Certified Staging)

| Resource | Location |
|----------|----------|
| Monitoring configs | `apps/backend/monitoring/` |
| Grafana dashboard UID | `homigo-operations` |
| Staging obs VM | `homigo-obs-staging` (GCE, asia-south1-b) |
| Alert rules | 42 rules — promtool validated |
| Stage F evidence | `docs/evidence/stage-f-remediation/` |

---

## Quick Reference — Certified Identity

| Field | Value |
|-------|-------|
| RC SHA | `c31f154a128022fa7d9c4e44652506eedf3fa3e4` |
| Image Digest | `sha256:0ad025d274fb806c838cea5b6b2ffa0b7dbdf5d15c616355a2d5638d9a31ab32` |
| Revision | `homigo-backend-staging-00029-pbn` |
| Staging | **CERTIFIED** |
| Production | **NOT DEPLOYED** |

---

## Document Map (Visual)

```
docs/
├── DOCUMENTATION-INDEX.md          ← YOU ARE HERE
├── architecture/                   ADRs, Blueprint, Traceability
├── certification/                  (see final-certification/)
├── evidence/                       237 runtime artifacts
├── executive/                      Executive handover
├── final-certification/            Phase 0 dossier (6 docs)
├── governance/                     Go/No-Go, completion report
├── knowledge-transfer/             Developer onboarding
├── operations/                     SOPs, promotion, rollback
├── release/                        Release notes
└── runbooks/                       Database restore
```

---

**Phase 0 Program:** CLOSED · **Documentation Package:** COMPLETE · **Next Phase:** Not started (planning only)
