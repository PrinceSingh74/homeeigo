# HOMIGO Phase 0 — Risk Register

**Document ID:** `PHASE-0-RISK-001`  
**Last Updated:** 2026-08-06  
**Cross-references:** [Final Report §9](./PHASE-0-FINAL-CERTIFICATION-REPORT.md#9-risk-register) · [Sign-Off](./PHASE-0-SIGNOFF.md) · [Checklist](./PHASE-0-PRODUCTION-READINESS-CHECKLIST.md)

---

## Legend

| Status | Meaning |
|--------|---------|
| **ACCEPTED** | Known risk explicitly accepted for Phase 0 closure |
| **DEFERRED** | Risk acknowledged; remediation planned in future phase |
| **MITIGATED** | Risk reduced by certification evidence or controls |
| **RESIDUAL** | Remaining risk after mitigation |

| Severity | Definition |
|----------|------------|
| **CRITICAL** | Could cause data loss, financial error, or security breach |
| **HIGH** | Significant operational impact; requires monitoring |
| **MEDIUM** | Manageable with workarounds |
| **LOW** | Minor impact; cosmetic or tooling |

---

## 1. Accepted Risks

| ID | Risk | Probability | Impact | Mitigation | Owner | Status |
|----|------|-------------|--------|------------|-------|--------|
| R-ACC-001 | **Scheduled job runner not implemented** — `ScheduledJobLagHigh` alert fires continuously (~20h lag) | Certain | MEDIUM | Documented as Phase 6 debt; does not affect outbox/consumers; alert classified NON_BLOCKING | Platform/Backend | **ACCEPTED** |
| R-ACC-002 | **Direct `dispatchEvent()` path** not certified for durable production delivery | Low (if code review enforced) | HIGH | Step 16 certifies outbox-only for durable events; architectural limitation documented | Backend | **ACCEPTED** |
| R-ACC-003 | **Staging-only certification** — production environment not runtime-tested | Certain | HIGH | Explicit scope boundary; production checklist required before go-live | Release Engineering | **ACCEPTED** |
| R-ACC-004 | **Full application schema parity deferred** beyond Wave-1 (31 migrations) | Low on Phase 0 paths | MEDIUM | Phase 0 paths certified; P2021 on deferred tables explained in Step 6/7 | DBA / Backend | **ACCEPTED** |
| R-ACC-005 | **Stage G Run 1 harness failure** — initial soak did not pass business gates | N/A (resolved) | LOW | Remediation run PASS; failure preserved in evidence for audit | SRE | **ACCEPTED** (resolved) |

**Evidence:** `scheduled-job-lag-root-cause.md`, `step-16-retry-dlq-replay-certification.md`, `STAGE-G-SOAK-CERTIFICATION-REPORT.md`, `stage-g-final-certification.md`

---

## 2. Deferred Risks

| ID | Risk | Probability | Impact | Planned Mitigation | Owner | Phase | Status |
|----|------|-------------|--------|-------------------|-------|-------|--------|
| R-DEF-001 | **OpenTelemetry not exported** — distributed traces lost on instance recycle | Medium | MEDIUM | OTel SDK + Cloud Trace per `opentelemetry-gap-analysis.md` | Platform | Post-Phase 0 RC | **DEFERRED** |
| R-DEF-002 | **Slack/PagerDuty alert delivery not configured** | Certain (staging) | HIGH (prod) | Provision `STAGING_SLACK_WEBHOOK_URL` / production equivalents | SRE | Pre-prod go-live | **DEFERRED** |
| R-DEF-003 | **HOMIGO Radar UI not built** — ops lacks unified health surface | Certain | MEDIUM | Implement per `homigo-radar-v1.md` spec | Product/Frontend | Phase 1+ | **DEFERRED** |
| R-DEF-004 | **Admin Alert Center ↔ Alertmanager bridge unwired** | Medium | MEDIUM | Wire Alertmanager webhook to admin endpoint on new RC | Backend/SRE | Post-Phase 0 RC | **DEFERRED** |
| R-DEF-005 | **Grafana ↔ Cloud Logging correlation links not provisioned** | Medium | LOW | Dashboard annotations + log query templates | SRE | Phase F follow-up | **DEFERRED** |
| R-DEF-006 | **Phase 6 scheduled job execution engine** | Certain | MEDIUM | Implement runner per automation-scheduler consumer TODO | Platform | Phase 6 | **DEFERRED** |
| R-DEF-007 | **Future ML / Analytics pipelines** | N/A | LOW | Not in Phase 0 scope | Data/AI | Future | **DEFERRED** |
| R-DEF-008 | **Live GCP alert policy redeploy** from updated monitoring JSON | Low | MEDIUM | Ops redeploy when ready (Step 6 note) | SRE | Pre-prod | **DEFERRED** |

**Evidence:** `STAGE-F-REMEDIATION-CERTIFICATION-REPORT.md`, `opentelemetry-gap-analysis.md`, `homigo-radar-v1.md`, `step-18-notification-routing.json`

---

## 3. Mitigated Risks

| ID | Risk | Original Impact | Mitigation Applied | Evidence | Status |
|----|------|-----------------|-------------------|----------|--------|
| R-MIT-001 | **Event loss during multi-instance processing** | CRITICAL | Leader lock + SKIP LOCKED + consumer receipts | Step 13 — 20/20 events, 0 lost | **MITIGATED** |
| R-MIT-002 | **Duplicate payment effects** | CRITICAL | DB idempotency + webhook dedup + `alreadySettled` | Step 12 — PASS | **MITIGATED** |
| R-MIT-003 | **Outbox backlog under burst load** | HIGH | Burst drain certified (100 + 500 events) | Step 14 — PASS, drain < seconds | **MITIGATED** |
| R-MIT-004 | **DLQ events unrecoverable** | HIGH | Operator replay certified | Step 16 — replayDeadLetterById PASS | **MITIGATED** |
| R-MIT-005 | **Database migration chain breakage** | CRITICAL | Wave-1 remediation + clean replay 31/31 | `step-d-wave1-clean-replay-certification.md` | **MITIGATED** |
| R-MIT-006 | **Memory leak under sustained load** | HIGH | 62.3 min soak — +2.5% growth, STABLE trend | `stage-g-soak-summary.json` | **MITIGATED** |
| R-MIT-007 | **Razorpay live credentials on staging** | CRITICAL | TEST mode enforced; live never used | All stage reports — RAZORPAY_LIVE_USED: NO | **MITIGATED** |
| R-MIT-008 | **Production accidental modification** | CRITICAL | Staging-only gates on every cert job | `stage-g-production-safety.json` | **MITIGATED** |
| R-MIT-009 | **Partner timestamp / ETA corruption** | HIGH | Full partner lifecycle + ETA label integrity | Step 11 — PASS | **MITIGATED** |
| R-MIT-010 | **Unobserved event platform failures** | HIGH | Permanent Prometheus + 42 alert rules + soak alert review | Stage F remediation + Stage G | **MITIGATED** |

---

## 4. Residual Risks

| ID | Risk | Probability | Impact | Current Controls | Owner | Status |
|----|------|-------------|--------|------------------|-------|--------|
| R-RES-001 | **Cloud Run CPU not in /metrics** — saturation detection indirect | Medium | MEDIUM | Alert absence + log review; no saturation during soak | SRE | **RESIDUAL** |
| R-RES-002 | **Operator identity not recorded on DLQ replay** | Low | LOW | WHAT/WHEN/EVENT_ID/DLQ_ID logged; WHO gap noted Step 16 | Backend | **RESIDUAL** |
| R-RES-003 | **Background metrics collector gcloud context limitation** | Medium | LOW | 5-min Prometheus snapshots used as primary trend evidence | SRE | **RESIDUAL** |
| R-RES-004 | **Forensic staging DB records retained** from cert runs | Certain | LOW | Synthetic fixtures only; PII scan PASS | DBA | **RESIDUAL** |
| R-RES-005 | **Single-region deployment** (asia-south1 only) | Low | HIGH | DR runbook exists; multi-region not Phase 0 scope | Platform | **RESIDUAL** |
| R-RES-006 | **Alert notification gap during incidents** until Slack wired | Medium | HIGH | Grafana + manual Cloud Logging; on-call process TBD | SRE | **RESIDUAL** |

---

## 5. Risk Heat Map

```
Impact →
         LOW      MEDIUM     HIGH       CRITICAL
    ┌─────────┬──────────┬──────────┬──────────┐
LOW │ R-RES-002│ R-DEF-005│          │          │
    ├─────────┼──────────┼──────────┼──────────┤
MED │ R-RES-003│ R-ACC-001│ R-DEF-002│          │
    │ R-RES-004│ R-DEF-003│ R-RES-006│          │
    ├─────────┼──────────┼──────────┼──────────┤
HIGH│          │ R-DEF-001│ R-ACC-003│ (none)   │
    │          │ R-ACC-004│ R-RES-005│          │
    ├─────────┼──────────┼──────────┼──────────┤
CERT│          │          │ R-ACC-002│ (mitigated)
    └─────────┴──────────┴──────────┴──────────┘
```

---

## 6. Risk Acceptance Statement

By closing Phase 0 with outcome **READY WITH DOCUMENTED LIMITATIONS**, the program accepts risks R-ACC-001 through R-ACC-005 and acknowledges deferred risks R-DEF-001 through R-DEF-008 must be addressed or re-accepted before unconditional production go-live.

**Residual risks R-RES-001 through R-RES-006** require ongoing monitoring and are within acceptable bounds for staging certification closure.

---

## 7. Review Schedule

| Review | Trigger | Owner |
|--------|---------|-------|
| Pre-production promotion | Before first production deploy | CTO + SRE |
| Post-OTel implementation | New RC certification | Platform |
| Quarterly | Scheduled | SRE + Security |
