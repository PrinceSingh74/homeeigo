# Phase 0 — PII Guide

## Allowed in event payloads

- Opaque IDs: `userId`, `providerId`, `bookingId`, `paymentId`, `serviceId`
- Operational: `status`, `city`, `serviceCategory`, `amountPaise`, timestamps
- ML-safe operational labels: `distanceKm`, `travelDurationMin`, `hourOfDay`, `dayOfWeek`

## Never publish

- Names, email, phone, full address
- Tokens, secrets, card data, credentials
- Raw fraud evidence, device fingerprints
- Full Prisma ORM objects

## Defense in depth

1. **Layer 1:** Typed allow-listed builders (`catalog/*.events.ts`)
2. **Layer 2:** Runtime `sanitizeEventPayload` + `assertNoProhibitedPii`
3. **Layer 3:** Tests that attempt prohibited fields
4. **Layer 4:** Structured logging without full payloads; enterprise audit sanitizer

## Money

Always integer **paise** in payloads (`amountPaise`, `finalAmountPaise`).

Events are never the financial source of truth — ledger remains authoritative.
