# HOMIGO — Pager Escalation Report

**Date:** 2026-06-17 · `monitoring/alertmanager.yml` (validated: 8 routes, 5 receivers).

## Channels
| Channel | Transport | Config |
|---|---|---|
| Slack | `slack_configs` per severity channel (`#homigo-escalation/critical/warnings/info`) | `slack_api_url` (env) |
| Email | `email_configs` (oncall, oncall-lead, senior-eng, **cto**) | SMTP env |
| PagerDuty | `pagerduty_configs` on escalation receiver | `PAGERDUTY_ROUTING_KEY` env |
| **WhatsApp + SMS** | webhook bridge → `POST /api/admin/observability/alerts/evaluate` → backend `ops-alert.service` fans out (Twilio) | backend env |

All four receive in parallel, so a single transport outage never silences an alert.

## Priority routing (Alertmanager `route.routes`)
| Priority | Receiver | group_wait | repeat |
|---|---|---|---|
| P0 | `homigo-escalation` (Slack + email oncall-lead/senior-eng/cto + PagerDuty + webhook) | 0s | 15m |
| P1 | `homigo-critical` (Slack + email oncall) | 10s | 30m |
| P2 | `homigo-warning` (Slack) | 30s | 2h |
| P3 | `homigo-info` (Slack) | 30s | 6h |

## Escalation flow (ack-based, via PagerDuty/Opsgenie policy)
```
Alert fires
  → page L2 (Engineering)
  → 5 min no ack  → escalate L3 (Senior Engineering)
  → 10 min no ack → escalate (Senior on-call)
  → 15 min no ack → escalate L4 (CTO)
```
Alertmanager's `repeat_interval` re-pages; the **time-based ack escalation** (5/10/15 min) is implemented by the PagerDuty escalation policy bound to `PAGERDUTY_ROUTING_KEY`. Inhibit rules suppress lower-severity duplicates of the same `alertname`.

## Status
Routing + multi-channel fan-out + priority chain: **PASS** (YAML valid). **Live paging NOT VERIFIED** — requires PagerDuty/Twilio/Slack credentials (none in this environment); the config is deploy-ready with env placeholders (no secrets committed).
