# Phase 5 Enterprise AI Tools — Admin Guide

## Accessing the Tool Center

Navigate: **AI HQ → Enterprise Tool Center** (`/ai-brain/tools`)

Requires admin JWT authentication.

## Pages & Sections

### Tool Registry
Full catalog of registered tools with category, risk level, service mapping, and status. Synced from built-in catalog on boot.

### Execution History
Recent tool invocations with status, duration, and timestamps. Filter via API: `/api/ai/tools/history?toolId=...&status=...`

### Approval Queue
Pending human approvals for high-risk actions. Each item shows tool name, risk score, and expiry.

**To approve:**
1. Review the approval in the queue
2. Use API `POST /api/ai/tools/approvals/:id/decide` with decision APPROVED
3. Re-execute tool with returned `approvalId`

### High Risk Queue
Filtered view of pending approvals for CRITICAL tools (refund, payout, ban, etc.).

### Denied Requests
Policy or validation denials — useful for debugging RBAC misconfiguration.

### Policy Explorer
Aggregate ALLOW/DENY/REQUIRES_APPROVAL counts and recent policy decision log.

### Usage Analytics
KPI cards: executions, success rate, denied count, average latency (7-day window).

## Common Admin Tasks

| Task | Action |
|------|--------|
| Sync registry | Click Refresh or call `GET /api/ai/tools/registry` |
| Approve refund request | Approval Queue → decide APPROVED → re-execute with approvalId |
| Investigate denial | Denied Requests → check policy rule in Policy Explorer |
| Monitor performance | Review metrics KPIs and Grafana dashboard 20 |

## RBAC

All Tool Center API endpoints require `ADMIN` role. Tool execution endpoint allows CUSTOMER/PARTNER/ADMIN based on tool definition.

## Related Consoles

- [AI Brain Console](/ai-brain) — Context, memory, prompts
- [Activity Timeline](/ai-brain/timeline) — Full AI audit trail including tool executions
