# Phase 0 — Event Catalog (v1.0)

Full semantics for each domain event. All events use CloudEvents-style envelope with `homigo.version = 1.0`.

---

## homigo.booking.created

| Field | Value |
|-------|-------|
| Meaning | New booking persisted |
| Producer | `booking.service.create()` |
| Trigger | Successful booking transaction |
| Aggregate | `booking` |
| PII | IDs + city only; no names/address |
| Consumers | metrics.v1, audit.v1, ai-context-indexer.v1 |
| Ordering | Per booking aggregate |
| Retry | Outbox at-least-once |

**Payload:** `bookingId`, `bookingNumber`, `userId`, `serviceId`, `serviceCategory`, `city`, `providerId`, `status`, `finalAmountPaise`, `paymentMethod`, `scheduledAt`

---

## homigo.booking.assigned

| Field | Value |
|-------|-------|
| Meaning | Provider accepted/assigned to booking |
| Producer | `booking.service.accept()` |
| Trigger | Accept transaction |
| Consumers | metrics.v1, audit.v1, ai-context-indexer.v1 |

**Payload:** `bookingId`, `userId`, `providerId`, `serviceId`, `assignedAt`, `eta`

---

## homigo.booking.started

| Field | Value |
|-------|-------|
| Meaning | Service work started (IN_PROGRESS) |
| Producer | `booking.service.start()` |
| Consumers | metrics.v1, audit.v1, ai-context-indexer.v1 |

**Payload:** `bookingId`, `userId`, `providerId`, `startedAt`

---

## homigo.booking.completed

| Field | Value |
|-------|-------|
| Meaning | Booking reached COMPLETED |
| Producer | `booking.service.complete()` |
| Consumers | metrics.v1, audit.v1, automation-scheduler.v1, ai-context-indexer.v1 |

**Payload:** `bookingId`, `userId`, `providerId`, `serviceId`, `completedAt`, `actualDurationMin`, `finalAmountPaise`

---

## homigo.booking.cancelled

| Field | Value |
|-------|-------|
| Meaning | Booking cancelled by user or partner |
| Producer | `booking.service.cancel()` |
| Consumers | metrics.v1, audit.v1, ai-context-indexer.v1 |

**Payload:** `bookingId`, `userId`, `providerId`, `cancelledBy`, `status`, `refundAmountPaise`, `cancelledAt`

---

## homigo.payment.success

| Field | Value |
|-------|-------|
| Meaning | Payment committed SUCCESS with ledger |
| Producer | `payment.service.verify()` + webhook `payment.captured` |
| Aggregate | `payment` |
| PII | IDs only |
| Consumers | metrics.v1, audit.v1, ai-context-indexer.v1 |

**Payload:** `paymentId`, `bookingId`, `userId`, `amountPaise`, `paymentMethod`, `completedAt`

---

## homigo.payment.failed

| Field | Value |
|-------|-------|
| Meaning | Gateway reported payment failure |
| Producer | `payment.service` webhook handler |
| Consumers | metrics.v1, audit.v1, ai-context-indexer.v1 |

**Payload:** `paymentId`, `bookingId`, `userId`, `amountPaise`, `reason`, `failedAt`

---

## homigo.partner.online / homigo.partner.offline

| Producer | `provider.service.setOnline()` |
| Consumers | metrics.v1, ai-context-indexer.v1 |

---

## homigo.partner.dispatched

| Producer | `assignment-engine.service` dispatch loop |
| Consumers | metrics.v1, audit.v1, ai-context-indexer.v1 |

---

## homigo.partner.en_route

| Producer | `tracking.service` first GPS en-route transition |
| Consumers | metrics.v1, ai-context-indexer.v1 |

---

## homigo.partner.arrived

| Producer | `tracking.service` GPS arrival detection (2 near pings) |
| Consumers | metrics.v1, audit.v1, ml-feature-sink.v1, ai-context-indexer.v1 |
| ML labels | `dispatchedAt`, `enRouteAt`, `arrivedAt`, `travelDurationMin`, `distanceKm`, `googleEtaMin`, temporal features |

`zoneId` and `weather` omitted when unavailable (not fabricated).
