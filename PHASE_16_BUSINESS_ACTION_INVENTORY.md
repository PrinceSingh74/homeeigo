# PHASE 16 — BUSINESS ACTION INVENTORY

Built by walking the actual service layer, route layer and tool catalog of this repository —
234 services, 48 route modules, 55 governed tools. Nothing here is invented; every row names a
real method that exists today.

The inventory has two halves, and the second is the more important one. Listing what an agent
*can* do is easy. What makes this a governance document is stating plainly which real business
actions an agent **deliberately cannot reach**, and why.

---

## 1. Agent-reachable actions (32 capabilities, 5 agents)

Every row: the capability the model plans against → the tool it resolves to → the authoritative
service behind it. The model never sees the middle column.

### Support Agent — `SUPPORT` role, `maxAutonomousRisk: MEDIUM`

| Capability | Tool | Service | Cat | Risk | Post-condition |
|---|---|---|---|---|---|
| `ticket.search` | `read.support.listTickets` | `supportTicket.adminList` | READ | LOW | n/a |
| `ticket.context` | `read.support.getTicketContext` | `supportContext.build` | READ | LOW | n/a |
| `ticket.analyze` | `read.support.analyzeTicket` | `supportIntelligence.analyze` | READ | LOW | n/a |
| `knowledge.search` | `read.support.searchKnowledge` | `knowledgeRetrieval.retrieve` | READ | LOW | n/a |
| `support.analytics` | `read.support.getAnalytics` | `supportTicket.adminAnalytics` | READ | LOW | n/a |
| `ticket.resolve` | `write.support.closeSupportTicket` | `supportTicket.adminResolve` | WRITE | MEDIUM | `ticket.status.changed` |
| `ticket.escalate` | `write.support.escalateTicket` | `supportTicket.adminEscalate` | WRITE | MEDIUM | `ticket.priority.escalated` |

### Operations Agent — `ADMIN`, `maxAutonomousRisk: MEDIUM`

| Capability | Tool | Service | Cat | Risk | Freshness |
|---|---|---|---|---|---|
| `ops.alerts` | `read.ops.getAlerts` | `opsAlert.list` | READ | LOW | — |
| `ops.zones` | `read.ops.getZoneIntelligence` | `geoIntelligence.zoneScoring` | READ | LOW | **300 s** |
| `ops.supplyDemand` | `read.admin.getSupplyDemand` | `geoIntelligence.zoneScoring` | READ | LOW | — |
| `ops.forecast` | `read.admin.getForecast` | `geoIntelligence.demandForecast` | READ | LOW | — |
| `ops.weather` | `read.common.getWeather` | `weather.getByCoords` | READ | LOW | — |
| `ops.coverage` | `read.ops.getCoverage` | `coverage.intelligence` | READ | LOW | **900 s** |
| `ops.cityTwin` | `read.ops.getCityTwin` | `digitalTwin.cityTwin` | READ | LOW | **300 s** |
| `ops.resolveAlert` | `write.ops.resolveAlert` | `opsAlert.resolve` | WRITE | MEDIUM | — |

### Partner Operations Agent — `ADMIN`, `maxAutonomousRisk: MEDIUM`

| Capability | Tool | Service | Cat | Risk | Post-condition |
|---|---|---|---|---|---|
| `partner.roster` | `read.partnerops.getRoster` | `partnerOperations.adminRoster` | READ | LOW | n/a |
| `partner.snapshot` | `read.partnerops.getPartnerSnapshot` | `partnerOperations.snapshot` | READ | LOW | n/a |
| `partner.intelligence` | `read.partnerops.getPartnerIntelligence` | `partnerIntelligence.getContext` | READ | LOW | n/a |
| `partner.notify` | `write.notification.sendPartnerNotification` | `notification.createForUser` | WRITE | MEDIUM | `notification.delivered` |

### Finance Assistant — `ADMIN`, `readOnly: true`, `maxAutonomousRisk: LOW`

| Capability | Tool | Service | Cat | Risk |
|---|---|---|---|---|
| `finance.summary` | `read.admin.getFinanceSummary` | `financeDashboard.getOverview` | READ | LOW |
| `finance.intelligence` | `read.finance.getIntelligence` | `financeIntelligence.getFinanceIntelligence` | READ | LOW |
| `finance.integrity` | `read.finance.getIntegrityReport` | `financialIntegrity.getLatestReport` | READ | LOW |
| `finance.reconciliation` | `read.finance.getReconciliation` | `ledgerReconciliation.buildReport` | READ | LOW |
| `finance.payoutHealth` | `read.finance.getPayoutMetrics` | `payoutOperations.dashboardMetrics` | READ | LOW |
| `finance.payoutQueue` | `read.finance.getPayoutQueue` | `payoutOperations.listQueue` | READ | LOW |
| `finance.anomalies` | `read.finance.getRevenueAnomalies` | `revenueAnomaly.evaluate` | READ | LOW (**900 s**) |

**Seven capabilities, zero writes.** Not "writes that are blocked" — writes that do not exist in
this agent's vocabulary. The registry throws at module import if one is added.

### Fraud Investigation Assistant — `ADMIN`, `readOnly: true`, `maxAutonomousRisk: LOW`

| Capability | Tool | Service | Cat | Risk |
|---|---|---|---|---|
| `fraud.summary` | `read.admin.getFraudSummary` | `fraudAdmin.overview` | READ | LOW |
| `fraud.queue` | `read.fraud.getReviewQueue` | `fraudAdmin.reviewQueue` | READ | LOW |
| `fraud.alerts` | `read.fraud.getAlerts` | `fraudAdmin.alerts` | READ | LOW |
| `fraud.evaluateUser` | `read.fraud.evaluateUser` | `fraudRisk.evaluateUser` | READ | LOW |
| `fraud.highRiskUsers` | `read.fraud.getHighRiskUsers` | `fraudAdmin.highRiskUsers` | READ | LOW |
| `fraud.decisions` | `read.fraud.getDecisionLog` | `fraudAdmin.decisionLog` | READ | LOW |

Two of these return a payload that says what it is in the data, not only in the prompt:
`fraud.evaluateUser` returns `kind: "RULE_AND_MODEL_SIGNAL", authoritative: false`, and
`fraud.highRiskUsers` returns `kind: "STORED_RISK_SCORE", authoritative: false`. A summariser that
never read the tool description still cannot present a score as a finding.

---

## 2. Actions discovered and deliberately NOT exposed

These exist in the codebase, an agent could technically be given them, and each was refused.
§74: *"High-risk restrictions are part of functionality."*

| Action | Service | Why no agent can reach it |
|---|---|---|
| `executeRefund` | `refundOrchestrator` | Money movement. §19 — no autonomous financial action, ever. |
| `approveBatch` / `rejectBatch` | `payoutOperations` | Releases partner payouts. Human-only by §19. |
| `retryPayout` | `payoutOperations` | Re-attempts a money transfer. Same boundary. |
| `approve` / `reject` | `financialAdjustment` | Direct ledger adjustment. |
| `approveResolution` / `escalate` | `settlementResolution` | Settles disputed money. |
| user ban / freeze / reversal | fraud enforcement (HIGH_RISK tools) | §21 — an agent is an investigator, never a judge. |
| `onApplicationApproved` | `partnerLifecycle` | Partner eligibility. §17 — no autonomous standing decisions. |
| `adminMerge` | `supportTicket` | Destructively folds one ticket into another. Detection is a read; the merge is a person's call. |
| pricing / surge overrides | `dynamicPricing` | Changes what every customer pays. |
| account deactivation | `accountLifecycle` | Irreversible from the user's side. |

Three independent mechanisms make these unreachable rather than merely unrequested:

1. **The registry throws at import** if any agent names a `HIGH_RISK` tool, or if a `readOnly`
   agent names a non-READ tool. The backend refuses to boot.
2. **The capability vocabulary is closed.** The model is shown capability names and never tool
   ids, so a plan cannot *name* one of these, and an unknown capability is rejected before any
   registry lookup.
3. **`disposeStep` escalates every HIGH-risk step** and every write from a read-only agent, at
   execution time, regardless of what validation concluded.

---

## 3. Governance properties, per action class

| Property | READ capabilities | WRITE capabilities |
|---|---|---|
| Policy evaluation | ✅ every call | ✅ every call |
| RBAC (role + permission) | ✅ | ✅ |
| Agent allowlist | ✅ registry | ✅ registry |
| Intent gate (§8) | n/a | ✅ refused under a read-only intent |
| Freshness gate (§35) | ✅ where declared | ✅ blocked by stale evidence |
| Idempotency | run key + step key | run key + step key + tool-layer key |
| Post-condition | `none.readonly` | ✅ mandatory, registry-enforced |
| Audit | ✅ `auditRequired: true` | ✅ |
| Rollback | n/a | escalation; no auto-retry on failed verification |

---

## 4. What this pass added, and why each was a real gap

| Capability | The question it made answerable |
|---|---|
| `ticket.search` | "Show me today's critical support issues." The agent could read a ticket it was **handed** but could not **find** one. The most ordinary operator request had no governed path. |
| `support.analytics` | "Are we breaching SLA?" |
| `partner.roster` | "Which partners in this zone are unavailable?" Same shape of gap on the partner side. |
| `ops.cityTwin` | "**Why** is this city under pressure?" §15 asks for cause and impact rather than "supply low"; the twin is the only place the platform already assembles both. |
| `ops.coverage` | "Where is demand going unserved?" |
| `finance.payoutHealth` / `finance.payoutQueue` | The payout pipeline is the most common real cause of the mismatch this assistant is asked to explain, and it could not see it. |
| `finance.anomalies` | "Is this month unusual?" — answered by the platform's own detector, not by model arithmetic. |
| `fraud.highRiskUsers` | "Who should I look at first?" |
| `ticket.escalate` | The one write whose failure mode points the safe way: a wrongly escalated ticket costs a person a few minutes. |

---

## 5. Coverage assessment

**Support** — complete for read, queue, analysis, knowledge, resolution and escalation.
Not exposed: merge (destructive), refund (money), compensation (money).

**Operations** — complete for alerts, zones, supply/demand, forecast, weather, coverage, city
twin and alert closure. Not exposed: pricing, dispatch override, capacity change.

**Partner Operations** — complete for roster, snapshot, intelligence and routine notification.
Not exposed: pause, resume, eligibility, pay, penalties.

**Finance** — complete for every authoritative read surface found. Zero writes, structurally.

**Fraud** — complete for queue, alerts, scores, high-risk ranking and the decision log. Zero
writes, structurally. Case *notes* were considered and refused: writing into an investigation
record shapes the evidence a human later reviews.

Remaining discovered-but-unexposed read surfaces (candidates, not gaps): ETA quality reports,
chargeback evidence, KYC state, academy progress. Each was left out because no agent has a
question that needs it today, and unused reach is still reach.
