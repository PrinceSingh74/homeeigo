# Evidence — Alert Reliability Report

Generated: 2026-06-25T11:12:30.995Z
Defined alert rules: 28 · Required conditions covered: 9/9

## Required Alert Coverage
| Required Condition | Covered by a rule? |
|---|:--:|
| High error rate | ✅ |
| Payment failures | ✅ |
| Database outage | ✅ |
| Redis outage | ✅ |
| High latency | ✅ |
| Webhook failure | ✅ |
| Disk pressure | ✅ |
| Memory pressure | ✅ |
| CPU pressure | ✅ |

## Severity Routing (delivery path)
| Severity (used by rules) | Routed in alertmanager.yml |
|---|:--:|
| critical | ✅ |
| warning | ✅ |
| escalation | ✅ |

## Delivery Channels Configured
- Slack: ✅ configured
- Email: ✅ configured
- PagerDuty/OpsGenie: ✅ configured
- Escalation chain receiver: ✅ `homigo-escalation`

## Defined Rules
| Alert | Severity |
|---|---|
| HighErrorRate | critical |
| RedisDown | critical |
| HighMemory | warning |
| PaymentFailureSpike | critical |
| RefundFailureSpike | warning |
| SettlementMismatch | critical |
| FinancialIntegrityBelow100 | critical |
| ReconciliationMatchRateLow | critical |
| SettlementDelay48h | warning |
| ProviderPayableDrift | critical |
| WalletLiabilityDrift | critical |
| DuplicatePaymentDetected | critical |
| ChargebackSpike | escalation |
| WebSocketConnectionsHigh | warning |
| AssignmentQueueBacklog | warning |
| DatabaseDown | critical |
| BackendDown | critical |
| HighRequestLatency | warning |
| WebhookFailureSpike | critical |
| FinanceIntegrityFailure | critical |
| ReconciliationMismatch | critical |
| WalletLiabilityMismatch | critical |
| ProviderPayableMismatch | critical |
| BookingSpike | warning |
| DatabasePoolSaturation | critical |
| DiskPressure | warning |
| CpuPressure | warning |
| MemoryPressureNode | warning |
