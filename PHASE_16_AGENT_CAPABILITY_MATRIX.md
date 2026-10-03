# PHASE 16 — AGENT CAPABILITY MATRIX

The question this document answers is §4's: **what useful work can each agent actually do?**

Not "what is it called", not "what could it theoretically reach" — what a real operator can ask
it, and what comes back.

---

## The chain every capability passes through

```
request
  → INTENT           does this request ask for a change at all?        §8   ← new
  → ADMISSION        agent enabled, kill switch, rate limit, recursion  §31/32
  → PLAN             model proposes capability names, never tool ids    §33
  → VALIDATE         allowlist, arguments, intent, clarification        §34  ← §9 new
  → CLASSIFY RISK    server-side; the model's claim is never consulted
  → DISPOSE          EXECUTE | SHADOW | ESCALATE
  → FRESHNESS        is the evidence datable, and current?              §35  ← new
  → EXECUTE          through executeTool: policy, RBAC, idempotency, audit
  → VERIFY           re-read the world; UNKNOWN is not a pass           §28
  → AUDIT
```

Three of those nine stages were added in this pass, and each closes a hole no other stage could
see. The intent gate is the sharpest: every other control authorises the **actor**, and only this
one authorises the **request**. By the time a plan reaches policy, "why did this fail" and "fix
this" are indistinguishable — same agent, same capability, same risk, same role.

---

## Support Agent

**Real requests it can serve**

| Operator asks | Intent | Capabilities used | Outcome |
|---|---|---|---|
| "Show me today's critical support issues." | QUERY | `ticket.search` | List, read-only |
| "Are we breaching SLA?" | QUERY | `support.analytics` | Counts + breach total |
| "Why is this ticket still open?" | EXPLAIN | `ticket.context`, `ticket.analyze` | Explanation. **A write step here is refused.** |
| "What's our policy on late cancellations?" | QUERY | `knowledge.search` | Grounded answer with citations |
| "Resolve ticket T-123 as a duplicate." | EXECUTE | `ticket.context` → `ticket.resolve` | Write, verified via `ticket.status.changed` |
| "Escalate T-123, the customer is stuck." | ESCALATE | `ticket.escalate` | Priority → HIGH, verified |
| "Resolve the ticket." *(no id)* | EXECUTE | — | **Asks "Which ticket?"** rather than guessing |
| "Approve a refund for T-123." | APPROVE | — | Refused: `INTENT_HUMAN_ONLY` |

**Cannot do:** refunds, compensation, entitlement decisions, ticket merges, anything touching
money. Not blocked at runtime — absent from the vocabulary.

---

## Operations Agent

| Operator asks | Intent | Capabilities used | Outcome |
|---|---|---|---|
| "Which zones are under capacity pressure?" | QUERY | `ops.zones`, `ops.supplyDemand` | Ranked zones with gap scoring |
| "Why is this city under pressure?" | EXPLAIN | `ops.cityTwin`, `ops.weather`, `ops.forecast` | **Cause + impact**, not "supply low" |
| "Where is demand going unserved?" | QUERY | `ops.coverage` | Unmet requests by city/area |
| "What's open right now?" | QUERY | `ops.alerts` | Open alerts with severity |
| "Close the alert, the surge has passed." | EXECUTE | `ops.alerts` → `ops.resolveAlert` | Write — **unless the zone read was stale** |

**The freshness interaction is the interesting one.** `ops.zones` is cached 180 s upstream. If the
scoring behind the decision is older than 300 s, or carries no datable timestamp, `ops.resolveAlert`
does not run: the step is recorded `AWAITING_APPROVAL` with `STALE_EVIDENCE:ops.zones` and a human
confirms the condition still holds.

Without that gate the run looks perfect — read succeeded, write authorised, post-condition confirms
the alert is resolved — while the platform has closed an alert about a condition it never
re-checked. Verification proves the write happened; it says nothing about whether the reason was
still true.

**Cannot do:** pricing, surge overrides, dispatch overrides, partner eligibility, capacity changes.

---

## Partner Operations Agent

| Operator asks | Intent | Capabilities used | Outcome |
|---|---|---|---|
| "Which partners in this zone are unavailable?" | QUERY | `partner.roster` | Filtered roster |
| "Why is this partner unavailable?" | EXPLAIN | `partner.snapshot`, `partner.intelligence` | Availability, capacity, readiness |
| "How is this partner performing?" | ANALYZE | `partner.intelligence` | Performance context |
| "Send them the shift reminder." | EXECUTE | `partner.notify` | Verified via `notification.delivered` |

**Cannot do:** pause, resume, suspend, deactivate, change pay, apply penalties, restrict access.
A performance score is not a reason to punish anyone. Also holds **no** `FINANCIAL` or `FRAUD`
data class, so a partner question needing either is an escalation, not a wider grant.

---

## Finance Assistant — read-only by construction

| Operator asks | Intent | Capabilities used |
|---|---|---|
| "Explain today's reconciliation mismatch." | EXPLAIN | `finance.reconciliation`, `finance.integrity`, `finance.payoutQueue` |
| "Is this month unusual?" | ANALYZE | `finance.anomalies` — the platform's own detector |
| "How healthy is the payout pipeline?" | QUERY | `finance.payoutHealth` |
| "What's our GMV and margin?" | QUERY | `finance.intelligence` |
| "Release this payout." | EXECUTE | **No capability exists.** |

**Seven capabilities, zero writes.** `readOnly: true` is enforced in three independent places:
the registry throws at module import, the plan validator refuses, and `disposeStep` escalates. The
first one takes the backend down at boot rather than shipping an assistant that can move money.

`finance.payoutQueue` returns `note: "Analysis only…"` **in the payload**, so a summariser that
never read the tool description still cannot present it as actionable.

No LLM arithmetic: every number comes from an authoritative finance service, so "the assistant said
X" and "the dashboard says Y" cannot diverge.

---

## Fraud Investigation Assistant — read-only by construction

| Operator asks | Intent | Capabilities used |
|---|---|---|
| "Who should I look at first?" | QUERY | `fraud.queue`, `fraud.highRiskUsers` |
| "Investigate this user." | INVESTIGATE | `fraud.evaluateUser`, `fraud.alerts`, `fraud.decisions` |
| "Is this pattern like the last case?" | ANALYZE | `fraud.alerts`, `fraud.decisions` |
| "Ban this user." | EXECUTE | **No capability exists.** |

Both scoring capabilities self-describe as signals in their returned data:

```json
{ "kind": "STORED_RISK_SCORE", "authoritative": false,
  "note": "A score is not a finding; only an investigator decision is." }
```

`fraud.decisions` — the human decision log — is the only authoritative record of an outcome.
A model score is evidence, never a verdict.

**Cannot do:** confirm fraud, ban, freeze funds, seize funds, reverse a payment, close a case, or
write investigation notes. Notes were considered and refused: writing into an investigation record
shapes the evidence a human later reviews.

---

## Cross-agent isolation

| From → To | Result |
|---|---|
| support → any finance capability | `UNKNOWN_CAPABILITY` — not in vocabulary |
| finance → any fraud capability | `UNKNOWN_CAPABILITY` |
| any → HIGH_RISK tool | registry throws at import; backend does not boot |
| read-only agent → any write | three independent refusals |

Four of the five agents run as `ADMIN`, so **role RBAC cannot tell them apart** — to the policy
engine they are the same actor. That is precisely why the agent, not the role, is the
authorisation subject, and why this registry exists as a distinct allowlist layer on top of
everything Phase 5 already enforces. An agent must pass **both**.

---

## Bounds, per agent

| Agent | Steps | Tool calls | Wall | Cost | Tokens | Depth |
|---|---|---|---|---|---|---|
| support | 8 | 10 | 90 s | $0.20 | 16 000 | 2 |
| operations | 8 | 12 | 120 s | $0.25 | 20 000 | 2 |
| partner-operations | 7 | 9 | 90 s | $0.20 | 16 000 | 2 |
| finance | 8 | 10 | 120 s | $0.20 | 20 000 | 1 |
| fraud | 8 | 12 | 120 s | $0.25 | 20 000 | 1 |

Clamped to the platform ceiling (8 / 12 / 120 s / $0.50 / 24 000 / 2); the tighter of the two
always wins, so raising a per-agent bound above the ceiling cannot widen it. The two read-only
assistants sit at `maxDepth: 1` — they are endpoints of a causation chain, never links in one.
