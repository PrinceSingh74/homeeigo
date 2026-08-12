# Evidence — Grafana Validation Report

**Generated:** 2026-06-08T17:47:00Z

## Static Coverage Audit (`bun run p2:grafana`) — ✅ PASS

| Metric | Value | Evidence file |
|---|---|---|
| Dashboards scanned | 1 | `homigo-observability.json` |
| Emitted metrics | 52 | parsed from metrics.ts + financial-metrics + services |
| Domain coverage | **100% (9/9)** | `grafana-coverage.md` |
| Validator exit code | 0 | executed this session |

### Domain matrix (all COVERED)

| Domain | Emitted | Dashboarded |
|---|:--:|:--:|
| API latency | ✅ | ✅ (panel 8: p50/p95/p99) |
| Database metrics | ✅ | ✅ |
| Wallet metrics | ✅ | ✅ (panel 9) |
| Payment metrics | ✅ | ✅ (panel 6) |
| Provider metrics | ✅ | ✅ |
| Booking metrics | ✅ | ✅ |
| WebSocket metrics | ✅ | ✅ |
| Finance metrics | ✅ | ✅ (panel 10) |
| Integrity metrics | ✅ | ✅ (panel 11) |

## Runtime Grafana Instance — ⚪ NOT VERIFIED

| Check | Status | Evidence |
|---|:--:|---|
| Grafana UI reachable | ❌ | No Grafana container/process on any probed port |
| Dashboard data freshness | ⚪ NOT VERIFIED | No Prometheus scrape → no live series |
| Query execution | ⚪ NOT VERIFIED | — |
| Alert visibility in Grafana | ⚪ NOT VERIFIED | — |

## Business / Security dashboards

| Dashboard | Static JSON | Live data |
|---|:--:|:--:|
| API | ✅ panel exists | ⚪ |
| Database | ✅ (via process metrics proxy) | ⚪ |
| Wallet | ✅ panel 9 | ⚪ |
| Payments | ✅ panel 6 | ⚪ |
| Finance | ✅ panel 10 | ⚪ |
| Security | ❌ no dedicated panel | ⚪ |
| Booking | ✅ (via HTTP + assignment backlog) | ⚪ |
| Infrastructure | ✅ (Redis, memory, WS) | ⚪ |
| Business | ❌ no dedicated panel | ⚪ |

**Verdict:** 🟡 **PARTIAL** — config coverage PASS; runtime freshness NOT VERIFIED.
