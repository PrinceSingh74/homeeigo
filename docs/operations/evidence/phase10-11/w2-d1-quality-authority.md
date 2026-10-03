# W2-D1 — Quality gate authority · FROZEN

## Defect, as measured (worse than the Wave 1 audit reported)

The completion quality gate accepted **three** independent client claims, not one:

1. `checklistComplete: true` in the body satisfied the checklist outright.
2. `completedChecklist` was compared by **length** — any three strings satisfied a three-item checklist.
3. `photos: [...]` in the body counted toward the photo requirement and, alone, satisfied the AFTER
   half of before/after — while those rows were persisted **after** the gate, on a best-effort path
   whose `try/catch` swallowed failures. A booking could complete against proof that was never stored.

Plus the reported fourth: proof counting read `mediaUrl` only, so every `mediaStorageKey`-backed
upload (the current storage path, written by `POST /:id/evidence`) was invisible to the gate.

## A fifth defect the fix exposed

`completedChecklist` and `checklistComplete` were **not declared** in the route's `t.Object` body
schema, so Elysia stripped both before the handler ran. Consequence: a booking with a non-empty
checklist **could not be completed over HTTP at all** — the array never reached the service. Found
by a diagnostic run after 4 of 13 integration tests returned 409 against valid input; the diagnostic
printed the durable rows, the frozen snapshot and the response side by side.

## Live exposure — measured on homigo_db, read-only

| | count |
|---|---|
| active services with a quality checklist | **0** of 48 |
| active services with `proofRequired` | **0** |
| active services with `beforeAfterPhotos` | **0** |
| bookings whose frozen snapshot carries a checklist | **0** |

The defect was latent: no live booking could have been completed through it, and no data is affected.

## Fix

- **`src/lib/quality-evidence.ts`** — the single resolver. Media counts only when a row carries an
  authoritative storage reference (`mediaStorageKey`, or legacy `mediaUrl`). The checklist is matched
  **item by item** against the frozen snapshot (case/space-normalised); missing items are returned.
- **`booking.service.ts complete()`** — media brought with the completion is written **before** the
  gate, awaited, outside any swallowing `try`; the gate then reads durable rows only. The
  `checklistComplete` parameter is removed from the service signature.
- **`routes/bookings.ts`** — both fields declared; `checklistComplete` accepted for wire
  compatibility with deployed clients and **discarded**, never forwarded.
- Error codes unchanged — `QUALITY_PROOF_REQUIRED`, `QUALITY_CHECKLIST_REQUIRED` — no duplicates.

## Evidence

| Suite | Result |
|---|---|
| `w2-d1-quality-authority.test.ts` (unit + structural) | **15 / 15** |
| `w2-d1-quality-authority.integration.test.ts` (HTTP + DB) | **13 / 13** |
| existing completion / money / e2e / four-axis suites | **55 / 55** |
| `tsc --noEmit` | clean |

Integration cases: untouched checklist + `true` → 409 · partial + `true` → 409 · three arbitrary
strings → 409 · proof absent + `true` → 409 · a bare `photos[]` claim → 409 · valid checklist + real
proof → 200 · **key-only proof recognised** (rows asserted `mediaUrl = NULL`) · case/space-insensitive
match → 200 · proof on a different booking → 409 · customer → 403 · unrelated partner → FORBIDDEN ·
forged evidence upload → refused, zero rows · duplicate completion → same `completedAt`, **one earning**.

## Tracked forward risk (not fixed here — belongs to P10.19 Partner UX)

Neither deployed partner client sends `completedChecklist`; both send `photos` only. Today that has
**zero** impact (no service has a checklist). The day an admin authors one, partners on current
builds cannot complete those jobs. The partner apps must gain checklist submission **before** any
checklist is configured. Recorded in the defect matrix as **D1-F1**.
