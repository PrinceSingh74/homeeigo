# Security & Data Governance Audit

**Score: 80%** · **HEAD:** `b582ead` · Audit-only · No security control was disabled or weakened during this audit

## Application-Layer Controls — STRONG

| Control | Status | Evidence |
|---|---|---|
| Authentication | IMPLEMENTED | Verified live: bad credentials → 401, valid → 200 + token |
| Authorization / RBAC | IMPLEMENTED | `ai/security/authorization.ts`, `ai-brain/security/brain-security.ts`; every tool declares `requiredRole` + `requiredPermission` + `requiredPolicy` |
| Prompt-injection defense | IMPLEMENTED | `ai/security/prompt-security.ts` |
| Output validation | IMPLEMENTED | `ai/security/output-validator.ts` (exceeds roadmap) |
| Tool argument validation | IMPLEMENTED | `ai-tools/security/tool-security.ts` + per-tool `validationSchema` |
| **Parameter tampering** | IMPLEMENTED | `APPROVAL_TAMPER` — arguments re-hashed at execution and compared to the approved hash (`execution-engine.ts:219-221`) |
| **Privilege escalation via approval** | IMPLEMENTED | `SELF_APPROVAL_DENIED` — requester cannot approve own request (`approval-engine.ts:40-42`) |
| Approval expiry | IMPLEMENTED | `expiresAt` enforced at decision time + `expireStaleApprovals()` sweeper |
| **Approval bypass** | IMPLEMENTED | Policy `REQUIRES_APPROVAL` short-circuits before any handler runs; execution with an `approvalId` re-validates `status === APPROVED` |
| Financial controls | IMPLEMENTED | All 6 financial high-risk actions are `CRITICAL`, `approvalRequired`, `maxRetries: 0` |
| Rate limiting | IMPLEMENTED | Gateway-level + per-tool |
| Timeouts | IMPLEMENTED | Per-tool `timeoutMs`; router abort detection |
| Audit integrity | IMPLEMENTED | Arguments and results stored as **hashes**, not raw values |
| PII in events | IMPLEMENTED | `sanitizeEventPayload` strips prohibited keys recursively; `assertNoProhibitedPii` throws — both unit-tested |
| PII in analytics | IMPLEMENTED | `analytics/etl/pii.ts` `hashPii()`; ETA labels store `partnerHash`/`customerHash`, never raw IDs |

The approval chain is the standout. Three independent controls — self-approval denial, expiry, and argument-hash tamper detection — is a stronger model than most systems of this class ship with.

## Findings

### SEC-1 · Grafana anonymous admin access — P1

```yaml
# apps/backend/monitoring/_obsstack/docker-compose.yml
GF_AUTH_ANONYMOUS_ENABLED: "true"
GF_AUTH_ANONYMOUS_ORG_ROLE: Admin
GF_SECURITY_ADMIN_PASSWORD: homigo_admin
```

Anyone who can reach :3004 gets **Grafana Admin without authenticating** — dashboard modification, datasource access, and arbitrary queries against platform metrics. The admin password is additionally hardcoded in a committed compose file.

*Recommendation:* disable anonymous auth, or scope it to `Viewer`; move the password to a secret reference. Not changed during this audit.

### SEC-2 · Unversioned production code — P0 (governance)

The entire Phase 5 tool/policy/approval layer runs from **untracked files** (39 under `src`). Security implications beyond release hygiene:

- No code review record for the layer that authorizes financial actions
- No attribution or provenance for security-critical logic
- No rollback path if a policy defect is found
- The audit trail claims integrity that the source tree cannot corroborate

*Recommendation:* commit with review before any production consideration.

### SEC-3 · Secrets posture — mixed

Positive: `deploy/observability/staging/docker-compose.yml` uses `${GRAFANA_ADMIN_PASSWORD:?required}` — a fail-closed guard. Negative: `_obsstack` hardcodes its password (SEC-1). Inconsistent between stacks.

No secret **values** were printed during this audit.

## Data Governance

| Requirement | Status | Evidence |
|---|---|---|
| PII minimization | IMPLEMENTED | Events carry IDs and hashes, not contact details |
| PII hashing | IMPLEMENTED | `hashPii()` for partner/customer in ETA labels and BQ rows |
| Data retention | IMPLEMENTED | Configurable: published outbox 14d, DLQ 90d, receipts 30d, scheduled jobs 60d (`events/core/config.ts`) |
| Memory TTL | NOT_VERIFIED | `AiMemory` present; TTL semantics not evidenced |
| Audit retention | PARTIAL | Event/tool audit retention configured; AI gateway audit retention not evidenced |
| Training-data provenance | PARTIAL | ETA labels carry `eventId` linking to the triggering event — good lineage. Dataset-level provenance not evidenced |
| Feature / dataset versioning | PARTIAL | `createVersion("pipeline", …)` confirmed; feature and dataset versioning not evidenced |
| Model lineage | NOT_VERIFIED | — |
| Prompt lineage | IMPLEMENTED | `AiPromptRegistry` + `AiPromptVersion` (10/10) |
| Tool audit lineage | IMPLEMENTED | `executionId`, `traceId`, `correlationId`, `approvalId`, argument/result hashes |
| Financial data protection | IMPLEMENTED | High-risk financial tools gated by policy + human approval |
| Customer data isolation | IMPLEMENTED | Ownership policies (`customer.ownership`, `customer.self`) on customer-scoped tools |

## Not Assessed

- Penetration testing (not performed this pass)
- Tenant isolation (no multi-tenancy model observed; may not apply)
- Network-layer controls, TLS termination, WAF
- Secret rotation procedures in practice

These are `NOT_VERIFIED`, not passes.

## Verdict

Application-layer security is **strong** and in places exceeds the roadmap. The two findings are infrastructure and governance rather than application logic: an openly accessible Grafana admin, and a security-critical code layer that exists outside version control.
