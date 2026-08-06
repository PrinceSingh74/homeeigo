# ADR-011: Staging Certification Strategy

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-08-06 |
| **Owner** | Release Engineering |
| **Review Date** | 2027-02-06 |
| **Certified RC** | `c31f154a128022fa7d9c4e44652506eedf3fa3e4` |

---

## Context

Phase 0 required more than unit tests: runtime certification against live staging infrastructure with preserved evidence suitable for enterprise audit. The program executed Stages C through G over four days, producing 237 evidence artifacts with explicit PASS/FAIL/LIMITED classification.

Production was never modified. Staging certification is the authoritative baseline for RC `c31f154`.

---

## Problem

Traditional release qualification gaps:

1. Tests pass locally but fail under Cloud Run multi-instance topology.
2. No durable evidence chain for auditors and enterprise customers.
3. Staging/prod parity unverified for critical paths (payments, events).
4. Failures in certification harnesses conflated with application regressions.

---

## Decision

Implement a **staged certification program** with mandatory properties:

### Stage structure

| Stage | Scope | Result |
|-------|-------|--------|
| **C** | Foundation — restore, deploy, migrations, schema | PASS |
| **D** | Business lifecycles — booking, partner, payment, integration | PASS |
| **E** | Event platform — multi-instance, burst, idempotency, DLQ | PASS |
| **F** | Observability — metrics, Grafana, alerts | PASS_WITH_LIMITATION |
| **G** | Soak — sustained operation, business regression | PASS |

### Certification rules

1. **Evidence mandatory** — every gate produces JSON and/or markdown in `docs/evidence/`.
2. **Release identity frozen** — certification authority is deployed artifact, not local dirty worktree.
3. **Production untouched** — `PRODUCTION_* = NO` verified each stage.
4. **SECRET_SCAN + PII_SCAN** — all evidence bundles scanned before preservation.
5. **Harness defects classified separately** — Stage G Run 1 FAIL (runner) vs Run 2 PASS (application).
6. **Opt-in safety** — `STAGING_EVENTS_CERTIFICATION=1` for harness execution.
7. **Razorpay TEST only** — `rzp_test_*`; live never used.

### Step granularity (certified steps)

| Steps | Description |
|-------|-------------|
| C: 4–7 | Restore, deploy, migration, schema |
| D: 8–12 | Integration, flags, booking, partner, payment |
| E: 13–16 | Multi-instance, drain, idempotency, retry/DLQ |
| F: 17–18 | Grafana/Prometheus, alerts (+ remediation) |
| G | 62.3-min soak (authoritative Run 2) |

### Outcome taxonomy

| Label | Meaning |
|-------|---------|
| PASS | Gate certified |
| PASS_WITH_LIMITATION | Certified with documented constraint |
| FAIL | Gate not met (must remediate or accept) |
| NOT EXECUTED | Out of scope (e.g., production) |
| UNKNOWN | Insufficient evidence |

### Final program result

**STAGING CERTIFIED** @ RC `c31f154` — **READY WITH DOCUMENTED LIMITATIONS** for production planning.

---

## Alternatives Considered

| Alternative | Reason Not Selected |
|-------------|---------------------|
| **Unit/integration tests only** | Insufficient for multi-instance, soak, payment gateway |
| **Production canary certification** | Production untouched requirement |
| **Third-party audit firm execution** | Internal harness with preserved evidence sufficient for Phase 0 |
| **Single monolithic cert script** | Staged gates isolate failure domains |
| **Skip soak** | Stage G required for sustained stability proof |

---

## Tradeoffs

| Benefit | Cost |
|---------|------|
| Audit-grade evidence chain | 4-day certification calendar |
| Isolated stage failure analysis | 237 artifacts to maintain |
| Harness vs app defect classification | Runner maintenance burden (Stage G lesson) |
| Staging-only safety | Production cert cycle still required |

---

## Consequences

**Positive:**
- 237 evidence files indexed in `docs/final-certification/PHASE-0-EVIDENCE-INDEX.md`.
- Zero lost events across all certified stages.
- Enterprise dossier complete in `docs/final-certification/`.

**Negative:**
- Stage G Run 1 failure required remediation — documented, not hidden.
- Full application schema parity not certified (Wave-1 only).

**Lessons learned (Stage G):**
- Certification harness must use unique fixture names per run.
- Payment orchestrator env vars must match dedicated deploy paths.

---

## Evidence References

| Artifact | Location |
|----------|----------|
| Final certification report | `docs/final-certification/PHASE-0-FINAL-CERTIFICATION-REPORT.md` |
| Evidence index | `docs/final-certification/PHASE-0-EVIDENCE-INDEX.md` |
| Sign-off | `docs/final-certification/PHASE-0-SIGNOFF.md` |
| Stage G Run 1 (FAIL) | `docs/evidence/stage-g-soak/STAGE-G-SOAK-CERTIFICATION-REPORT.md` |
| Stage G Run 2 (PASS) | `docs/evidence/stage-g-soak/stage-g-final-certification.md` |
| Certification harness | `apps/backend/scripts/stage-d-staging-certification.ts`, `phase0-full-certification.ts` |

---

## Future Evolution

| Item | Phase | Notes |
|------|-------|-------|
| Production certification program | Pre-prod | Mirror stage structure |
| CI-triggered cert subset | Release Engineering | Smoke cert on each RC |
| Harness hardening | SRE | Stage G remediation items closed |
| Annual re-certification | Compliance | Scheduled review |

---

## Related ADRs

ADR-010 (Deployment) · ADR-012 (Production Promotion) · All domain ADRs (001–009)
