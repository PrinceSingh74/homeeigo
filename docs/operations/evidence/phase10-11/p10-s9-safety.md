# Phase 10 §9 Safety engine (P10.5) + chemical / age / medical controls (P10.6)

**Status:** CLOSED in code and on the isolated test DB. **Live: migration `20260924200000_booking_safety_holds` not applied (OP-8).** **No live service has safety content**, so on live only the incident half of the gate is active: an open incident on an active booking now stops START and COMPLETE. Full backend regression: **3540 pass / 0 fail / 289 files**. Browser verified on the isolated stack.

## Before (measured on homigo_db, read-only, 2026-09-24)

- `catalog_config.safety` (prohibitedConditions, warnings, customer/provider requirements, medicalDisclaimer, emergencyProtocol) had **no runtime reader at all**. It was display-only.
- The readiness check was `cfg?.safetyNotes?.length || cfg?.safety ? "ok" : "ok"`: a control that could never fire.
- 0 of 48 active services had safety content.
- The partner SOS / incident system worked (admin queue: assign, acknowledge, resolve). But an **open incident on a booking did not stop START or COMPLETE**.
- **3 SOS incidents have been OPEN since 26 Aug – 2 Sep.** Two are linked to already-cancelled test bookings (`S03L-…`); one has no booking. This is an operational item for the owner (Domain 32).

## Architecture (reuse, no second safety system)

```
catalog_config.safety ──(booking create)──► booking snapshot safety.v1  (frozen: what was prohibited / warned at booking)
partner reports a listed prohibited condition
   ├─► partner_safety_incidents  (EXISTING queue — escalation, assign/ack/resolve)
   └─► booking_safety_holds ACTIVE (new, typed)
gate = ACTIVE holds ∪ open incidents on the booking
   → START (before the §6 requirement gate), step START/COMPLETE, COMPLETE (before the §8 gate)
admin releases a hold (reason, audited)   ·   incident resolved in its own queue
booking_safety_audit (trigger, append-only) · realtime via the one publisher
```

- **Precedence (P10.5):** safety is evaluated before preconditions (§6) and before the execution gate (§8), and a test proves it. With a hold and an unresolved precondition both present, START answers `SAFETY_HOLD_ACTIVE`. Clear the safety, and the next answer is `REQUIREMENT_GATE_BLOCKED`.
- **No workaround:**
  - A partner can raise a hold but never release one.
  - A customer can do neither.
  - An admin release does not clear a linked open incident. Both must be clear.
  - A released hold is immutable in the DB, and the audit is append-only.
- **Nothing invented:**
  - A partner can raise only a condition from the booking's frozen list. Anything else goes through the existing SOS / incident flow, and still gates.
  - The customer sees warnings, what to do, the medical disclaimer and the emergency protocol. They never see provider requirements, the partner's note or incident internals.
- **P10.6:**
  - *Chemical restrictions:* expressible only as configured prohibited conditions / warnings. No formulation or mixing advice exists anywhere in this path.
  - *Medical:* the disclaimer and emergency protocol are shown from the booking snapshot. No diagnosis path exists.
  - *Age restrictions:* **no configuration field exists** and none was invented. It needs an owner policy decision (whose age, what limit, what evidence), so it is recorded as EXTERNAL.

## Tests

- `p10-s9-safety.test.ts`: **14** unit and structural tests. They cover:
  - empty snapshot for unconfigured services;
  - verbatim freeze;
  - customer projection excludes provider requirements;
  - gate semantics for holds and incidents;
  - human-safe message;
  - condition matching restricted to the frozen list;
  - precedence order in START and COMPLETE;
  - escalation reuses `partnerSafetyService.reportIssue`;
  - additive migration;
  - release at BOOKINGS/APPROVE.
- `p10-s9-safety.integration.test.ts`: **8** through the real routes. They cover:
  - snapshot + customer/partner views, outsider 404;
  - unlisted condition refused; customer cannot raise;
  - raise opens a LOCATION_DANGER incident plus an ACTIVE hold; idempotent re-raise;
  - precedence at START;
  - admin-only release with reason (route and service both refuse a blank reason);
  - incident still blocks until resolved, then the precondition answers, then START 200;
  - hold mid-job stops COMPLETE;
  - audit rows; DB refuses reactivating a released hold and editing the audit.
- **Reintroduction:** 7 fixes reverted one at a time in `D:/homigo-w2-scratch`, all caught. Scratch restored identical afterwards.

| Reverted | Result |
|---|---|
| S9-a START ignores safety | 4 fail |
| S9-b COMPLETE ignores safety | 1 fail |
| S9-c open incidents do not gate | 4 fail |
| S9-d any condition accepted | 6 fail |
| S9-e service accepts a blank release reason | 4 fail (after adding a direct service assertion; the first run showed the route schema masked it, so the test was strengthened) |
| S9-f customer sees provider requirements | 2 fail |
| S9-g no incident escalation | 4 fail |

- **Typecheck:** backend + all five clients exit 0.

## Clients

| Client | What it shows |
|---|---|
| Partner web / partner mobile | Safety panel: wear/bring, warnings, emergency protocol, "Report a prohibited condition (stops the job)" with the booking's own list, and a red "Stop — safety hold" alert |
| Customer web / customer mobile | Safety card: what to do, warnings, disclaimer, emergency protocol, and "Work is paused for safety: … our safety team is looking into it" |
| Admin | Safety card: holds (condition, source, state, raised, incident link → `/trust-safety/incidents/:id`, note, release reason), "Release hold" through the audited dialog with a required reason, and a Safety audit table with request/trace |

## Operator actions

| Id | Action |
|---|---|
| OP-8 | `bunx prisma migrate deploy` — applies `20260924200000_booking_safety_holds` (additive). |
| OWNER-CONTENT | Author per-service safety content (prohibited conditions, warnings, PPE, disclaimer, emergency protocol). Age restrictions need a policy decision first. |
| OWNER-OPS | 3 SOS incidents OPEN since August (2 on cancelled test bookings). Resolve or close them in `/trust-safety/incidents`. |

## Full regression

One clean run, no reruns: **3540 pass / 0 fail / 289 files**, exit 0.

## Browser verification (isolated stack; seed `scripts/e2e-seed-phase10-s9-browser.ts`)

| Step | Observed |
|---|---|
| Partner opens the job | Safety panel: "Wear / bring: Insulated gloves", the warning, the emergency protocol, and a report selector listing exactly the booking's two prohibited conditions |
| Partner reports "Gas smell in the room" with a note | red alert: "Stop — safety hold. … prohibited condition reported: Gas smell in the room; 1 open safety incident" |
| Customer opens the booking | "Work is paused for safety: Gas smell in the room. Our safety team is looking into it…" plus what to do, the warning, the disclaimer and the emergency protocol. **The partner's note and the provider requirements are not shown** |
| Admin booking page | Safety card with the hold (source, raised by partner, incident id, note) and a Safety audit row with request/trace |
| Admin "Release hold" with a reason | audit RELEASED; gate message becomes "1 open safety incident"; the incident still blocks |

**axe:** partner 0, customer 0, admin 0. Console: no partner or admin errors. The customer errors were the maps loader (egress deliberately blocked) and one 404 asset.

### Defect found by the browser run: S9-X admin DataTable never re-rendered on a value change

After the release, the audit said RELEASED but the holds table still read **"Active"** with a live "Release hold" button. Root cause: `DataTable`'s memo comparator compared `rows.length:columns` only, so **any admin table whose values change without its row count changing showed stale data**. That covered statuses, refunds and steps across the whole console. Fix: a cell-wise comparator (strings by value, elements by reference).

**Proof:**
- With the fix, the row flips to "Released" in place and the button disappears.
- With the old comparator restored in the admin copy, the same script leaves the button in place (`releaseButtonGoneAfter: false`).
- Admin typecheck exit 0.
- The admin app has no unit-test runner; the browser script `s9-admin-stale.mjs` is the regression proof.

Cleanup: servers stopped, tsconfig/next-env restored, `.next-p10` removed, admin-copy junction removed (real admin `node_modules` intact, 362 entries). The empty `D:\homigo-p10-admin` folder remains; the session's protection blocks deleting it.

**§9 CLOSED and frozen** (live needs OP-8 + owner-authored safety content; age restrictions EXTERNAL).
