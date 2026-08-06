# Master Traceability Matrix

**Document ID:** `ARCH-TRACE-001`  
**Certified RC:** `c31f154a128022fa7d9c4e44652506eedf3fa3e4`  
**Last Updated:** 2026-08-06  
**Navigation:** [Documentation Index](../DOCUMENTATION-INDEX.md) · [ADR Index](./ADR-INDEX.md)

---

## Purpose

Every architecture decision, certification gate, and operational procedure in the Phase 0 package traces to authoritative runtime evidence. This matrix is the **single audit cross-reference** linking ADRs, evidence, certification stages, runbooks, risks, and release artifacts.

**Rule:** If an item is not in this matrix, it is not part of the certified Phase 0 baseline.

---

## 1. ADR Traceability

| ADR | Title | Stage | Runtime Proof | Evidence Path | Runbook | Risk IDs |
|-----|-------|-------|---------------|---------------|---------|----------|
| ADR-001 | Transactional Outbox | D, E, G | 0 lost events; burst drain | `stage-e-step-14/`, `stage-g-soak/stage-g-final-reconciliation.json` | [Rollback §10](../operations/ROLLBACK-RUNBOOK.md) | R-MIT-001 |
| ADR-002 | Event Driven Architecture | D | 18/18 gates; event matrix | `stage-d/stage-d-gates-20260804T105915Z.json` | [Ops Handbook §Event](../operations/ENTERPRISE-OPERATIONS-HANDBOOK.md) | — |
| ADR-003 | Leader + SKIP LOCKED | E | 20/20 events; 0 dup claims | `stage-e-step-13/step-13-multi-instance-certification.md` | [Ops Handbook §Outbox](../operations/ENTERPRISE-OPERATIONS-HANDBOOK.md) | R-MIT-001 |
| ADR-004 | Retry Strategy | E | Backoff + retry timeline | `stage-e-step-16/step-16-retry-timeline.json` | [Rollback §11](../operations/ROLLBACK-RUNBOOK.md) | — |
| ADR-005 | Dead Letter Queue | D, E | DLQ create + replay PASS | `stage-e-step-16/step-16-dlq-state.json` | [Ops Handbook §DLQ](../operations/ENTERPRISE-OPERATIONS-HANDBOOK.md) | R-MIT-004 |
| ADR-006 | Idempotency | E | 0 duplicate effects | `stage-e-step-15/step-15-idempotency-certification.md` | — | R-MIT-001 |
| ADR-007 | Payment Atomicity | D | TEST payment 12/12 gates | `stage-d-step-12/step-12-payment-certification.md` | [Ops Handbook §Payment](../operations/ENTERPRISE-OPERATIONS-HANDBOOK.md) | R-MIT-002 |
| ADR-008 | Observability | F, G | Permanent scrape up=1 | `stage-f-remediation/permanent-scrape-proof.json` | [Ops Handbook §Observability](../operations/ENTERPRISE-OPERATIONS-HANDBOOK.md) | R-DEF-001, R-MIT-010 |
| ADR-009 | Alerting | F | 42 rules; lifecycle PASS | `stage-f-step-18/step-18-rule-validation.json` | [Ops Handbook §Alerts](../operations/ENTERPRISE-OPERATIONS-HANDBOOK.md) | R-DEF-002, R-RES-006 |
| ADR-010 | Deployment | C, D | Digest chain verified | `stage-d-step-8/step-8-integration-certification.md` | [Promotion Runbook](../operations/PRODUCTION-PROMOTION-RUNBOOK.md) | — |
| ADR-011 | Staging Certification | C–G | 237 artifacts | `docs/final-certification/PHASE-0-EVIDENCE-INDEX.md` | — | R-ACC-003 |
| ADR-012 | Production Promotion | — | NOT EXECUTED (prod) | `docs/final-certification/PHASE-0-PRODUCTION-READINESS-CHECKLIST.md` | [Promotion Runbook](../operations/PRODUCTION-PROMOTION-RUNBOOK.md) | R-ACC-003, R-DEF-002 |

---

## 2. Certification Stage Traceability

| Stage | Result | Primary Report | Gate Evidence | ADRs | Runbook |
|-------|--------|----------------|---------------|------|---------|
| C | PASS | `stage-c-step-6/step-6-final-certification.md` | Steps 4–7 folders | ADR-010, 011 | [database-restore.md](../runbooks/database-restore.md) |
| D | PASS | `stage-d/stage-d-certification.md` | `stage-d-gates-*.json`, steps 8–12 | ADR-001, 002, 007 | [stage-d-runbook.md](../evidence/stage-d/stage-d-runbook.md) |
| E | PASS | Steps 13–16 reports | `step-13` through `step-16` folders | ADR-001, 003–006 | [Rollback](../operations/ROLLBACK-RUNBOOK.md) |
| F | PASS_WITH_LIMITATION | `stage-f-remediation/STAGE-F-REMEDIATION-CERTIFICATION-REPORT.md` | `stage-f-step-17/`, `stage-f-step-18/` | ADR-008, 009 | [Ops Handbook](../operations/ENTERPRISE-OPERATIONS-HANDBOOK.md) |
| G | PASS | `stage-g-soak/stage-g-final-certification.md` | `stage-g-soak-summary.json` | ADR-001–009 | [Ops Handbook §Soak ref](../operations/ENTERPRISE-OPERATIONS-HANDBOOK.md) |

---

## 3. Domain Capability Traceability

| Capability | Certified | Step | Evidence | ADR | Checklist § |
|------------|-----------|------|----------|-----|-------------|
| Booking lifecycle | YES (staging) | 10 | `stage-d-step-10/` | ADR-002 | Checklist §5 |
| Partner lifecycle | YES (staging) | 11 | `stage-d-step-11/` | ADR-002 | Checklist §6 |
| Payment TEST | YES (staging) | 12 | `stage-d-step-12/` | ADR-007 | Checklist §4 |
| Payment LIVE | **NO** | — | — | ADR-007, 012 | Checklist §4.9 |
| Outbox drain | YES | 14 | `stage-e-step-14/` | ADR-001 | Checklist §7 |
| Multi-instance | YES | 13 | `stage-e-step-13/` | ADR-003 | Checklist §7.5 |
| Idempotency | YES | 15 | `stage-e-step-15/` | ADR-006 | Checklist §7.7 |
| DLQ replay | YES | 16 | `stage-e-step-16/` | ADR-005 | Checklist §7.9 |
| Integration tests | YES | 8 | `stage-d-step-8/step-8-test-results.json` | — | Checklist §10.1 |
| Soak 62.3 min | YES | G Run 2 | `stage-g-soak-timing.json` | ADR-011 | Checklist §10.8 |
| Production deploy | **NO** | — | — | ADR-012 | Checklist §12.5 |

---

## 4. Governance Document Traceability

| Document | Traces To |
|----------|-----------|
| [PRODUCTION-GO-NOGO-BOARD-PACK.md](../governance/PRODUCTION-GO-NOGO-BOARD-PACK.md) | Final Report, Risk Register, Sign-Off, Release Notes |
| [EXECUTIVE-HANDOVER.md](../executive/EXECUTIVE-HANDOVER.md) | Final Report, Executive Summary, Blueprint |
| [DOCUMENTATION-INDEX.md](../DOCUMENTATION-INDEX.md) | All docs/ folders |
| [DOCUMENTATION-COMPLETION-REPORT.md](../governance/DOCUMENTATION-COMPLETION-REPORT.md) | This matrix, Index |

---

## 5. Operations Runbook Traceability

| Runbook | ADRs | Evidence | Certification |
|---------|------|----------|---------------|
| [PRODUCTION-PROMOTION-RUNBOOK.md](../operations/PRODUCTION-PROMOTION-RUNBOOK.md) | ADR-010, 012 | Stage D runbook, Step 4 PITR | Staging patterns certified; **prod NOT EXECUTED** |
| [ROLLBACK-RUNBOOK.md](../operations/ROLLBACK-RUNBOOK.md) | ADR-001, 003, 005, 010 | `stage-d-certification-status.md`, Step 16 | Staging rollback SHA documented |
| [ENTERPRISE-OPERATIONS-HANDBOOK.md](../operations/ENTERPRISE-OPERATIONS-HANDBOOK.md) | ADR-008, 009 | Stage F, Stage G metrics | Staging SOPs from certified baselines |
| [database-restore.md](../runbooks/database-restore.md) | ADR-010 | `stage-c-step-4/` | PITR clone PASS |

---

## 6. Release Artifact Traceability

| Release Item | Source Evidence | ADR |
|--------------|-----------------|-----|
| RC SHA `c31f154` | `stage-g-release-identity.json` | ADR-010 |
| Digest `sha256:0ad025…` | `stage-g-release-identity.json` | ADR-010 |
| Revision `00029-pbn` | `stage-g-release-identity.json` | ADR-010 |
| 31/31 migrations | `stage-g-migrations.json` | ADR-010 |
| Known limitations | Risk Register R-ACC, R-DEF | ADR-011, 012 |
| NOT production deployed | `stage-g-production-safety.json` | ADR-012 |

[Release Notes](../release/RELEASE-NOTES-RC-c31f154.md)

---

## 7. Risk Register Traceability

| Risk ID | ADR | Evidence | Runbook Section |
|---------|-----|----------|-----------------|
| R-ACC-001 | ADR-002 | `scheduled-job-lag-root-cause.md` | Ops Handbook §Scheduled Job |
| R-ACC-002 | ADR-001 | Step 16 architectural limitation | Developer Onboarding §5 |
| R-ACC-003 | ADR-012 | All stages PRODUCTION=NO | Go/No-Go §15 |
| R-DEF-001 | ADR-008 | `opentelemetry-gap-analysis.md` | Blueprint §14–15 |
| R-DEF-002 | ADR-009 | `step-18-slack-delivery.json` | Promotion Runbook §14 |
| R-DEF-003 | ADR-008 | `homigo-radar-v1.md` | Blueprint §2 |
| R-RES-005 | ADR-012 | Single region staging | Promotion Runbook §3.2 |
| R-RES-006 | ADR-009 | Stage G alert review | Ops Handbook §Alerts |

Full register: [PHASE-0-RISK-REGISTER.md](../final-certification/PHASE-0-RISK-REGISTER.md)

---

## 8. Production Checklist Cross-Map

Each checklist section in [PHASE-0-PRODUCTION-READINESS-CHECKLIST.md](../final-certification/PHASE-0-PRODUCTION-READINESS-CHECKLIST.md) maps to:

| Checklist § | Evidence Folder | Staging Status |
|-------------|-----------------|----------------|
| §1 Infrastructure | `stage-g-environment.json` | ✅ Certified |
| §2 Database | Steps 6, 7, Wave-1 | ✅ Certified |
| §3 Secrets | All stage reports | ✅ Staging / ❓ Prod |
| §4 Payments | Step 12 | ✅ TEST / ❌ LIVE |
| §5–6 Booking/Partner | Steps 10, 11 | ✅ Certified |
| §7 Event Engine | Steps 13–16, G | ✅ Certified |
| §8–9 Observability/Alerts | Stage F | ⚠️ Limited |
| §10 Performance | Step 14, G | ✅ Certified |
| §11 DR | Step 4, 6A | ✅ Certified |
| §12 Operational | Phase 0 dossier | ⚠️ Prod NOT EXECUTED |

---

## 9. Supplemental Document Traceability

| Document | Type | Traces To ADR | Evidence |
|----------|------|---------------|----------|
| `homigo-radar-v1.md` | Spec (deferred) | ADR-008, 009 | Stage F remediation |
| `opentelemetry-gap-analysis.md` | Gap analysis | ADR-008 | Stage F remediation |
| `adr-001-staging-observability-platform.md` | Historical ADR | ADR-008 | Stage F Step 17 |
| `phase-0-event-foundation.md` | Dev doc | ADR-001, 002 | `apps/backend/docs/intelligence/` |

---

## 10. Traceability Coverage Statement

| Category | Items Mapped | Coverage |
|----------|--------------|----------|
| ADRs (12) | 12 | 100% |
| Certification stages (C–G) | 5 | 100% |
| Domain capabilities (certified) | 11/13 | 100% of certified; LIVE/prod explicitly excluded |
| Governance docs | 4 | 100% |
| Operations runbooks | 4 | 100% |
| Risk register entries | 29 | 100% |
| Evidence folders (22) | 22 | 100% |

**Nothing in the Phase 0 package exists without a trace path in this matrix.**

---

**Maintained by:** Platform Architecture · **Review:** 2027-02-06
