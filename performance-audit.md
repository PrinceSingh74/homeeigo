# Performance Audit

**Generated:** 2026-07-03T09:56:49.523Z

## Runtime Metrics

- /metrics lines: 615
- DB latency: 6ms
- Redis latency: 7ms
- Memory RSS: 174MB

## Known Patterns

- Admin HQ: useRenderProbe/useMountProbe on dashboards
- Paginated lists: placeholderData (prev) — no extra network
- Command center: 30s polling on geo-intel
- WS invalidation on booking/notification events

_Performance coverage: 75% (metrics live)_
