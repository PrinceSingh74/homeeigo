# Runbook 06 — WebSocket Failure
**Symptoms:** customers not seeing live tracking, `ws.close` spikes, reconnect storms.
1. Backend up? WS shares the HTTP server (:3000).
2. Auth failures (4401)? Check JWT validity + `authenticateWsConnection`; room auth via `canAccessBookingWs`.
3. Fan-out: if multi-instance, Redis pub/sub channel `WS_FANOUT` must be healthy (else cross-instance rooms break — see 05).
4. Client auto-reconnects (`use-realtime-channel`) + refetches tracking on reconnect; data is never lost (DB is source of truth).
5. Verify: a booking tracking room receives `tracking.location_update` on a provider ping.
