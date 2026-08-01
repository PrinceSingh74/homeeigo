# Phase 0 — Security Threat Model

| Threat | Mitigation |
|--------|------------|
| PII leakage in events | Typed builders + runtime sanitizer + tests |
| Payload injection | Envelope validation; max payload bytes (`EVENTS_MAX_PAYLOAD_BYTES`) |
| Unauthorized event production | Only server-side services call `emitInTransaction`; no public emit API |
| Forged internal events | Events originate from DB outbox after business tx; not accepted from clients |
| Replay abuse | No public replay API; operator-only helpers; consumer receipts |
| DLQ data exposure | DLQ in PostgreSQL; same access controls as production DB |
| Oversized payloads | Rejected at validation boundary |
| Log injection | Structured logging; no raw payload logging by default |
| Redis trust assumptions | Outbox SoT is PostgreSQL; Redis only for leader lock / presence |
| Scheduled job tampering | Jobs created only by trusted consumers; no user-facing create API |

Phase 0 controls reduce risk but do **not** alone constitute legal DPDP compliance claims.
