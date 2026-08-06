# ADR-009: Alerting Strategy

| Field | Value |
|-------|-------|
| **Status** | Accepted |
| **Date** | 2026-08-06 |
| **Owner** | SRE |
| **Review Date** | 2027-02-06 |
| **Certified RC** | `c31f154a128022fa7d9c4e44652506eedf3fa3e4` |

---

## Context

The event platform requires automated detection of backlog growth, stale events, consumer failures, DLQ accumulation, and scheduled job lag. Stage F Step 18 certified Prometheus alert rule validation and lifecycle transitions. Stage F remediation deployed rules on the permanent Alertmanager instance.

Notification delivery to Slack/PagerDuty is **NOT_CONFIGURED** on staging — alerts evaluate and appear in Alertmanager but do not route externally.

---

## Problem

Without evaluated alerts:

1. Outbox backlog grows undetected until business impact.
2. Consumer failure rate spikes pass unnoticed.
3. DLQ accumulation requires manual metric inspection.
4. On-call engineers lack paging integration for staging incidents (and production has no stack yet).

---

## Decision

### Alert rule source

- Primary ruleset: `apps/backend/monitoring/homigo-alerts.yml` — **42 rules**, promtool validated SUCCESS.
- Enterprise supplement: additional rules in monitoring directory (42+18 referenced in remediation report).
- Deployment: Prometheus on `homigo-obs-staging` loads validated rules; Alertmanager uses `alertmanager-staging.yml`.

### Event platform rules (certified lifecycles)

| Alert | Purpose | Step 18 Result |
|-------|---------|----------------|
| `EventOutboxBacklogHigh` | Pending outbox threshold | PASS — inactive→pending→firing→resolved |
| `EventOutboxOldestPendingStale` | Oldest pending age | PASS — full lifecycle |
| `EventConsumerFailureRateHigh` | Consumer error rate | PASS_WITH_LIMITATION — safe injection impractical |
| `EventDlqGrowing` | DLQ accumulation | PASS_WITH_LIMITATION — 15m `for:` not fully awaited |
| `ScheduledJobLagHigh` | Automation job backlog | PASS_WITH_LIMITATION — pre-existing architectural debt |

### Notification routing

| Receiver | Staging Status |
|----------|----------------|
| Alertmanager → Slack | **NOT_CONFIGURED** — `STAGING_SLACK_WEBHOOK_URL` absent |
| Alertmanager → Admin Alert Center | **NOT WIRED** on RC `c31f154` |
| Grafana annotations | Available for engineering investigation |

**Classification during Stage G soak:**

| Alert | State | Classification |
|-------|-------|----------------|
| EventOutboxBacklogHigh | inactive | MONITOR |
| EventOutboxOldestPendingStale | inactive | MONITOR |
| EventConsumerFailureRateHigh | inactive | MONITOR |
| EventDlqGrowing | inactive | MONITOR |
| ScheduledJobLagHigh | **firing** | KNOWN_PREEXISTING_ARCHITECTURAL_DEBT |

### Staging isolation

- Staging-only receivers; no production PagerDuty/Slack activated during certification.
- Synthetic Step 18 alert data cleaned post-certification.

---

## Alternatives Considered

| Alternative | Reason Not Selected |
|-------------|---------------------|
| **Cloud Monitoring alert policies only** | Existing PromQL rules and Grafana integration in repo |
| **No alerts until production** | Stage G soak requires continuous evaluation |
| **Lower ScheduledJobLagHigh threshold to suppress** | Masks real debt; documented as NON_BLOCKING instead |
| **Email-only notifications** | Slack/webhook standard for engineering; not configured yet |
| **Alert on every log ERROR** | Noise; metric-based rules preferred |

---

## Tradeoffs

| Benefit | Cost |
|---------|------|
| Rules validated before deploy | VM-based Alertmanager ops burden |
| Lifecycle tested with synthetic data | Synthetic injection impractical for consumer failure |
| Known debt alert documented | Continuous firing until Phase 6 runner |
| 42 rules cover platform + domain | Production routing still required |

---

## Consequences

**Positive:**
- Stage F Step 18: rule validation PASS; outbox/stale full lifecycle PASS.
- Stage F remediation: permanent platform re-cert PASS_WITH_LIMITATION.
- Stage G: no unexpected alert storms during 62.3-min soak.

**Negative:**
- No external notification — operators must poll Grafana/Alertmanager.
- Consumer failure alert not end-to-end proven with firing state.

**Operational:**
- Production promotion must provision webhook secrets before go-live (ADR-012).

---

## Evidence References

| Artifact | Location |
|----------|----------|
| Step 18 certification | `docs/evidence/stage-f-step-18/step-18-alert-certification.md` |
| Rule validation | `docs/evidence/stage-f-step-18/step-18-rule-validation.json` |
| Notification routing | `docs/evidence/stage-f-step-18/step-18-notification-routing.json` |
| Permanent alert lifecycle | `docs/evidence/stage-f-remediation/step-18-permanent-alert-lifecycle.json` |
| Slack delivery status | `docs/evidence/stage-f-remediation/step-18-slack-delivery.json` |
| Scheduled job lag RCA | `docs/evidence/stage-f-remediation/scheduled-job-lag-root-cause.md` |
| Stage G alert review | `docs/evidence/stage-g-soak/stage-g-alert-review.json` |

---

## Future Evolution

| Item | Phase | Notes |
|------|-------|-------|
| STAGING_SLACK_WEBHOOK_URL provisioning | Immediate ops | Unblocks delivery testing |
| Production PagerDuty integration | Pre-prod | Separate receivers |
| Admin Alert Center webhook | Post-Phase 0 RC | Token-gated endpoint |
| SLO-based alert tuning | SRE | Reduce false positives post-launch |
| HOMIGO Radar alert inbox | Product | `homigo-radar-v1.md` |

---

## Related ADRs

ADR-008 (Observability) · ADR-005 (DLQ) · ADR-012 (Production Promotion)
