# PHASE 16 — TOOL GOVERNANCE

## No second registry

Phase 16 added **15 tools** to the existing catalog by spreading them into `TOOL_CATALOG` — 14
READ and one narrow WRITE (`write.ops.resolveAlert`). There is exactly one registry, so there is
exactly one set of policy, audit, discovery and idempotency guarantees to keep in step.

Catalog after Phase 16, as seeded to `ai_tool_registry`:

```
READ 48 · WRITE 13 · HIGH_RISK 14 = 75 tools
```

The asymmetry is deliberate. Phase 16 is about governed reasoning over authoritative data; every
new *write* surface is new blast radius. The agents' only other side-effecting capabilities reuse
tools that already existed and were already certified.

## Handlers compute nothing

Every Phase-16 handler is a thin typed adapter onto an existing authoritative service. No
arithmetic, no reclassification, no risk scoring, no ledger derivation — otherwise "the assistant
said X" and "the console says Y" become two different truths about the same platform.

`read.support.analyzeTicket` is the clearest case. It calls `supportIntelligenceService.analyze`,
which already composes context + classification + recommendation + eligibility + priority. An
earlier draft split this into three tools and re-assembled those parts in the agent layer; that
would have been a second support-analysis path able to disagree with the support console. Collapsed
to one tool over the existing service.

## Permissions fit the roles, not the reverse

`requiredPermission` values were chosen to fall **inside** namespaces the existing
`ROLE_TOOL_PERMISSIONS` table already grants:

| Agent role | Existing grant | Phase-16 permission |
|---|---|---|
| `SUPPORT` | `tools.read.common.*` | `tools.read.common.support_context`, `support_analysis`, `knowledge` |
| `ADMIN` | `tools.read.admin.*` | `tools.read.admin.ops_alerts`, `finance_intelligence`, `fraud_queue`, ... |
| `ADMIN` | `tools.write.admin.*` | `tools.write.admin.ops_alert_resolve` |

Widening the role table to fit a new tool would hand every holder of that role a capability nobody
reviewed. **The role table was not modified.**

## Identity is derived, never asserted

Where the platform can derive identity it does. Where an id is a legitimate argument — a provider
under review, a ticket, a user under investigation — the tool is admin-gated and the underlying
service performs its own scoping, exactly as it does for the HTTP route.

The `read.partnerops.*` family exists precisely because the `read.partner.*` family resolves the
provider from the **authenticated actor**, which is meaningful only when a partner is the caller.
An admin-run agent must name a partner, so those are separate, admin-gated tools rather than a
loosened version of the partner ones.

## Readiness is a stated condition

Every capability tool's execution writes an audit row carrying a **foreign key onto
`ai_tool_registry`**. On an environment where that table is unseeded, every tool call fails at the
audit write — before the handler — with an opaque `EXECUTION_ERROR` naming neither the table nor
the cause.

Found exactly that way: agents reported `LIVE`, planned correctly, and could execute nothing.
It fails closed, which is the right direction, but "silently broken" and "correctly refusing" must
not look the same to an operator.

`checkAgentReadiness()` now resolves every capability tool against the database and reports
`{ready, reasons, registrySeeded, missingTools}`. Surfaced on `GET /api/agents` and rendered as a
banner in the control center.

> **Certified — K0.** `ready=true missingTools=0`.

## Structural invariants, enforced at import time

`agent-registry.ts` throws at module load — taking the process down at boot rather than shipping a
misconfigured agent — if any of these hold:

- a capability resolves to no tool (an action with no policy evaluation, no audit, no idempotency)
- a capability names an unknown or non-`ACTIVE` tool
- a declared risk is below the tool's implied risk
- a read-only agent declares a side-effecting capability
- **any** agent declares a `HIGH_RISK` capability
- a side-effecting capability declares no post-condition
- a capability touches a data class the agent does not declare

> **Certified — A2 / A3 / A4, forensic F3a / F3b / F3c.**
