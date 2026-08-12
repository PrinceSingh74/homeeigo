# WebSocket Audit

**Generated:** 2026-07-03T09:56:49.523Z

## Channels

| Room Pattern | Path | Auth | Frontend Bridges |
|--------------|------|------|------------------|
| tracking:{bookingId} | /ws/tracking/:bookingId | JWT+ACL | web, mobile |
| user:{userId} | /ws/notifications | JWT+ACL | all apps |
| booking:{id} | /ws/booking/:bookingId | JWT+ACL | web, mobile |
| earnings:{providerId} | /ws/earnings/:providerId | JWT+provider | partner |
| admin:ops | /ws/admin-ops | JWT+ADMIN | admin |

## Infrastructure

- Redis fan-out: ws:fanout channel
- Heartbeat: lib/heartbeat.ts
- Metrics: /api/v1/ws/stats (admin only)
- Reconnect: exponential backoff in use-realtime-channel.ts (all apps)

## Runtime

Backend WS stats endpoint requires admin auth — not probed without token.
