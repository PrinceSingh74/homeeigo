# Phase 5 Evidence Index

| Evidence | Path |
|----------|------|
| ADR-017 | `docs/architecture/adr-017-phase-5-ai-tools.md` |
| API Documentation | `docs/api/PHASE-5-AI-TOOLS-API.md` |
| Operations Runbook | `docs/operations/PHASE-5-AI-TOOLS-RUNBOOK.md` |
| Recovery Runbook | `docs/operations/PHASE-5-AI-TOOLS-RECOVERY-RUNBOOK.md` |
| Security Review | `docs/security/PHASE-5-AI-TOOLS-SECURITY-REVIEW.md` |
| Admin Guide | `docs/admin/PHASE-5-AI-TOOLS-ADMIN-GUIDE.md` |
| Certification Report | `docs/final-certification/PHASE-5-CERTIFICATION-REPORT.md` |
| Implementation Report | `docs/final-certification/PHASE-5-IMPLEMENTATION-REPORT.md` |
| Certification Script | `apps/backend/scripts/phase-5-certification.ts` |
| Grafana Dashboard | `apps/backend/monitoring/grafana/dashboards/homigo-ai-tools.json` |
| Alert Rules | `apps/backend/monitoring/rules/homigo-alerts.yml` (homigo_ai_tools group) |
| Tool Catalog Source | `apps/backend/src/ai-tools/registry/tool-catalog.ts` |
| Admin UI | `apps/admin-panel/src/app/(console)/ai-brain/tools/page.tsx` |
| Cert Fixtures Script | `apps/backend/scripts/phase-5-cert-fixtures.ts` |
| Closure Script | `apps/backend/scripts/phase-5-certification-closure.ts` |
| Runtime Verification | `apps/backend/scripts/phase-5-runtime-verification.ts` |
| Playwright Admin E2E | `apps/admin-panel/e2e/ai-tools-center.spec.ts` |

## Runtime Evidence (Phase 5 Closure)

| Artifact | Path |
|----------|------|
| Cert Fixtures | `docs/evidence/phase-5/cert-fixtures.json` |
| Partner Read Tools | `docs/evidence/phase-5/partner-read-tools.json` |
| Read Tools Execution | `docs/evidence/phase-5/read-tools-execution.json` |
| Write Tools Execution | `docs/evidence/phase-5/write-tools-execution.json` |
| Performance Benchmark | `docs/evidence/phase-5/performance.json` |
| Health Endpoint | `docs/evidence/phase-5/health-endpoint.json` |
| Gateway Orchestration | `docs/evidence/phase-5/gateway-orchestration.json` |
| Observability Scrape | `docs/evidence/phase-5/observability-scrape.json` |
| Admin UI Playwright | `docs/evidence/phase-5/admin-ui-playwright.log` |
| Regression Smoke | `docs/evidence/phase-5/regression-smoke.json` |
| Closure Summary | `docs/evidence/phase-5/closure-summary.json` |

## Verification Commands

```bash
# Ensure demo fixtures (partner provider, cert bookings)
cd apps/backend && bun run --env-file=.env scripts/phase-5-cert-fixtures.ts

# Full Phase 5 closure (runtime certification)
AI_TOOL_CERTIFICATION_MODE=true bun run --env-file=.env scripts/phase-5-certification-closure.ts

# Final enterprise verification (independent re-certification)
AI_TOOL_CERTIFICATION_MODE=true bun run --env-file=.env scripts/phase-5-final-enterprise-verification.ts

# Admin UI browser verification (requires Homigo backend on 3010, admin on 3003)
cd apps/admin-panel && E2E_SKIP_SERVERS=1 npx playwright test e2e/ai-tools-center.spec.ts

# Public health check (no JWT)
curl http://localhost:3010/api/ai/tools/health
```
