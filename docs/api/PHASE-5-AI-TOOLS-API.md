# Phase 5 Enterprise AI Tools — API Reference

Base path: `/api/ai/tools`

All endpoints except `/health` require JWT authentication.

## Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | Public | Tool layer health and counts |
| GET | `/` | Admin | List tools (memory or DB) |
| GET | `/registry` | Admin | Seed and list DB registry |
| GET | `/:id` | Admin | Get tool definition |
| POST | `/execute` | Authenticated | Execute a tool |
| GET | `/history` | Admin | Execution history |
| GET | `/approvals` | Admin | Pending approval queue |
| POST | `/approvals/:id/decide` | Admin | Approve or reject |
| POST | `/approvals/:id/cancel` | Admin | Cancel pending approval |
| GET | `/approvals/:id` | Admin | Get approval detail |
| GET | `/policies` | Admin | Policy explorer |
| GET | `/denied` | Admin | Denied execution requests |
| GET | `/high-risk` | Admin | High-risk approval queue |
| GET | `/metrics` | Admin | Usage and performance metrics |

## Execute Tool

```http
POST /api/ai/tools/execute
Authorization: Bearer <token>
Content-Type: application/json

{
  "toolId": "read.customer.getBookings",
  "arguments": { "page": 1, "limit": 10 },
  "idempotencyKey": "optional-unique-key",
  "correlationId": "optional-trace-correlation",
  "approvalId": "required-for-approved-high-risk-retries"
}
```

### Response (success)

```json
{
  "success": true,
  "data": {
    "executionId": "uuid",
    "status": "SUCCESS",
    "policyDecision": "ALLOW",
    "result": { },
    "durationMs": 42
  }
}
```

### Response (requires approval)

```json
{
  "success": true,
  "data": {
    "executionId": "uuid",
    "status": "PENDING_APPROVAL",
    "policyDecision": "REQUIRES_APPROVAL",
    "approvalId": "uuid",
    "requiresApproval": true,
    "durationMs": 5
  }
}
```

## Tool Categories

| Category | Count | Direct Execution |
|----------|-------|------------------|
| READ | 30+ | Yes (via policy) |
| WRITE | 13 | Yes (via policy) |
| HIGH_RISK | 14 | No — approval required |

## Error Codes

| Code | HTTP | Description |
|------|------|-------------|
| TOOL_NOT_FOUND | 404 | Unknown tool ID |
| VALIDATION_ERROR | 400 | Invalid arguments |
| POLICY_DENIED | 200 | Policy engine denied (status=DENIED) |
| RATE_LIMITED | 429 | Per-actor tool rate limit |
| APPROVAL_REQUIRED | 400 | Missing valid approval |
| APPROVAL_TAMPER | 400 | Arguments changed since approval |
| TOOLS_DISABLED | 503 | AI_TOOLS_ENABLED=false |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| AI_TOOLS_ENABLED | true | Master switch |
| AI_TOOL_APPROVAL_EXPIRY_HOURS | 24 | Approval TTL |
| AI_TOOL_DEFAULT_TIMEOUT_MS | 30000 | Default tool timeout |
| AI_TOOL_MAINTENANCE_BLOCK_WRITES | true | Block writes in maintenance |
| AI_TOOL_BUSINESS_HOURS_ONLY | false | Restrict medium writes outside IST hours |
