# HOMIGO Architecture Decision Records — Index

**Program:** Phase 0 Event Foundation  
**Certified RC:** `c31f154a128022fa7d9c4e44652506eedf3fa3e4`  
**Last Updated:** 2026-08-06  
**Status:** Active  

**Related documentation:**
[Phase 0 Final Certification Report](../final-certification/PHASE-0-FINAL-CERTIFICATION-REPORT.md) ·
[Release Notes RC c31f154](../release/RELEASE-NOTES-RC-c31f154.md) ·
[Production Promotion Runbook](../operations/PRODUCTION-PROMOTION-RUNBOOK.md)

---

## Purpose

This index catalogs authoritative Architecture Decision Records (ADRs) for the HOMIGO backend platform as certified in Phase 0. Each ADR documents a significant architectural choice, its rationale, tradeoffs, and traceability to runtime certification evidence.

ADRs are **normative for RC `c31f154`**. Changes that alter documented decisions require a new ADR and a separate certification cycle.

---

## ADR Catalog

| ID | Title | Status | Owner | Review Date | Document |
|----|-------|--------|-------|-------------|----------|
| ADR-001 | Transactional Outbox Pattern | Accepted | Platform / Backend | 2027-02-06 | [adr-001-transactional-outbox-pattern.md](./adr-001-transactional-outbox-pattern.md) |
| ADR-002 | Event Driven Architecture | Accepted | Platform / Backend | 2027-02-06 | [adr-002-event-driven-architecture.md](./adr-002-event-driven-architecture.md) |
| ADR-003 | Leader Election + FOR UPDATE SKIP LOCKED | Accepted | Platform / SRE | 2027-02-06 | [adr-003-leader-election-skip-locked.md](./adr-003-leader-election-skip-locked.md) |
| ADR-004 | Retry Strategy | Accepted | Platform / Backend | 2027-02-06 | [adr-004-retry-strategy.md](./adr-004-retry-strategy.md) |
| ADR-005 | Dead Letter Queue Strategy | Accepted | Platform / Backend | 2027-02-06 | [adr-005-dead-letter-queue-strategy.md](./adr-005-dead-letter-queue-strategy.md) |
| ADR-006 | Idempotency Strategy | Accepted | Platform / Backend | 2027-02-06 | [adr-006-idempotency-strategy.md](./adr-006-idempotency-strategy.md) |
| ADR-007 | Payment Financial Atomicity | Accepted | Payments / Backend | 2027-02-06 | [adr-007-payment-financial-atomicity.md](./adr-007-payment-financial-atomicity.md) |
| ADR-008 | Observability Architecture | Accepted | SRE / Platform | 2027-02-06 | [adr-008-observability-architecture.md](./adr-008-observability-architecture.md) |
| ADR-009 | Alerting Strategy | Accepted | SRE | 2027-02-06 | [adr-009-alerting-strategy.md](./adr-009-alerting-strategy.md) |
| ADR-010 | Deployment Strategy | Accepted | Release Engineering | 2027-02-06 | [adr-010-deployment-strategy.md](./adr-010-deployment-strategy.md) |
| ADR-011 | Staging Certification Strategy | Accepted | Release Engineering | 2027-02-06 | [adr-011-staging-certification-strategy.md](./adr-011-staging-certification-strategy.md) |
| ADR-012 | Production Promotion Strategy | Accepted | Release Engineering / CTO | 2027-02-06 | [adr-012-production-promotion-strategy.md](./adr-012-production-promotion-strategy.md) |
| ADR-013 | Phase 1 ML Data Platform | Accepted | Platform / Data Engineering | 2027-02-06 | [adr-013-phase-1-ml-data-platform.md](./adr-013-phase-1-ml-data-platform.md) |
| ADR-014 | Phase 2 ETA Intelligence Label Collection | Accepted | Platform / Data Engineering | 2027-02-07 | [adr-014-phase-2-eta-intelligence.md](./adr-014-phase-2-eta-intelligence.md) |

**Total ADRs:** 14

---

## Supplemental Architecture Documents

These documents support ADRs but are not numbered ADRs:

| Document | Relationship |
|----------|--------------|
| [adr-001-staging-observability-platform.md](./adr-001-staging-observability-platform.md) | Historical Stage F decision; content consolidated into ADR-008 |
| [homigo-radar-v1.md](./homigo-radar-v1.md) | Product specification referenced by ADR-008 and ADR-009; UI deferred |
| [opentelemetry-gap-analysis.md](./opentelemetry-gap-analysis.md) | Gap analysis referenced by ADR-008; OTel export deferred |

---

## Certification Alignment

| Stage | Result | ADRs Primarily Supported |
|-------|--------|--------------------------|
| Stage C | PASS | ADR-010, ADR-011 |
| Stage D | PASS | ADR-001, ADR-002, ADR-007, ADR-010 |
| Stage E | PASS | ADR-001, ADR-003, ADR-004, ADR-005, ADR-006 |
| Stage F | PASS_WITH_LIMITATION | ADR-008, ADR-009 |
| Stage G | PASS | ADR-001–ADR-009 (soak validation) |

**Staging certification:** Complete @ RC `c31f154`  
**Production deployment:** Not executed (ADR-012 governs promotion)

---

## ADR Lifecycle

| Status | Meaning |
|--------|---------|
| Proposed | Under review; not yet binding |
| Accepted | Binding for certified RC and successors until superseded |
| Deprecated | Superseded; retained for history |
| Superseded | Replaced by another ADR (link required) |

---

## How to Propose a New ADR

1. Copy the template structure from any ADR in this index.
2. Assign the next sequential ID.
3. Include evidence references from `docs/evidence/` or a new certification run.
4. Update this index.
5. Obtain owner review before changing status to Accepted.

---

## Traceability Matrix (ADR → Evidence)

| ADR | Primary Evidence |
|-----|------------------|
| ADR-001 | `stage-e-step-14/`, `stage-d-step-10/` |
| ADR-002 | `stage-d-step-9/`, `stage-d/stage-d-certification.md` |
| ADR-003 | `stage-e-step-13/step-13-multi-instance-certification.md` |
| ADR-004 | `stage-e-step-16/step-16-retry-dlq-replay-certification.md` |
| ADR-005 | `stage-e-step-16/`, `stage-d/stage-d-certification.md` (D7 replay) |
| ADR-006 | `stage-e-step-15/step-15-idempotency-certification.md` |
| ADR-007 | `stage-d-step-12/step-12-payment-certification.md` |
| ADR-008 | `stage-f-remediation/STAGE-F-REMEDIATION-CERTIFICATION-REPORT.md` |
| ADR-009 | `stage-f-step-18/step-18-alert-certification.md` |
| ADR-010 | `stage-c-step-5/`, `stage-d/stage-d-runbook.md` |
| ADR-011 | `docs/final-certification/PHASE-0-FINAL-CERTIFICATION-REPORT.md` |
| ADR-012 | `docs/final-certification/PHASE-0-PRODUCTION-READINESS-CHECKLIST.md` |
