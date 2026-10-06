# Phase 12–14 tracker

Started 2026-10-06, after an item-by-item audit of the Phase 12–14 specification against the code showed that the earlier "closed" status was too strong. This file is the working list; `PHASE-12-14-FINAL-CERTIFICATION.md` is corrected from it.

**Status: NOT CLOSED.** P0 and P1 are fixed and evidenced as listed below, and two adversarial re-audits were run after the fixes. Each re-audit found further defects; most were fixed, and the ones that remain are in "Open". P2 and P3 have not started.

Statuses: **FIXED** (code and tests written, the evidence named ran green; driven in a browser where it says so), **OPEN**, **DECISION NEEDED**.

Rules for this pass: existing ACTIVE services stay live; no missing business fact is invented; no new Prisma lifecycle enum; no second booking, matching, payment, refund, execution, audit or capacity engine.

## P0 — trust, security, truth

| # | Item | Status | Evidence |
|---|---|---|---|
| P0-1 | Customer `/book`: fabricated metrics and badges | FIXED, browser | "Popular" only on the catalogue's own flag; no invented tier names or tags. `booking-page-truth.test.ts`; journey step "no invented statistic or badge" |
| P0-2 | Cancellation terms hard-coded on `/book` and on the refund policy page | FIXED, browser | Both render `GET /api/bookings/cancellation-policy`. Journey and public-page runs compare the page with the server's tiers |
| P0-3 | Success dialog: "payable at service", "cancel anytime", "Booking confirmed!" before anyone accepted | FIXED, browser | "Payment received", "₹X paid online"; booking status wording follows payment and assignment (`statusConfigFor`) |
| P0-4 | Summary and saved bookings named a price tier or a made-up package / professional | FIXED | Server selection label and price; real professional name or "Professional not assigned yet" |
| P0-5 | Professional-preference selector did nothing | FIXED (removed) | The backend cannot honour a preference |
| P0-5b | Placeholder ₹0 tier, demo catalogue, demo wallet and profile data outside production builds | FIXED, browser | Demo data is on only for `NEXT_PUBLIC_ENABLE_MOCK_BUSINESS_DATA=true`; a release build refuses the flag. The browser run found "COOL100 / ₹150 OFF" on the home page of a development build; `mock-data-opt-in.test.ts` now scans every source file |
| P0-5c | Invented statistics, ratings, static reviews, promo codes, "AI" and "verified / background-checked" claims on home, services, assistant, wallet and support surfaces | FIXED, browser for home / services / bookings | Server values or nothing; "approved professionals". `tests/truth/*` (customer web 204 tests) |
| P0-6 | Partner: "I'm at the customer" sent the job's coordinates as the partner's position; arrival and start trusted the request | FIXED, browser | The option is removed. `/arrived`, `/start` and the on-site requirement check are confirmed against the position the server holds (recent, at the job); `LOCATION_UNCONFIRMED` / `LOCATION_MISMATCH`; a mismatch records a FAKE_ARRIVAL signal. `arrival-position.test.ts`, `arrival-server-position.integration.test.ts` (10). Journey passes with the rule in force. **See Open 1–2 for what this does not stop** |
| P0-6b | A device that cannot give a position | FIXED | Admin waiver for one booking and one partner, reason of at least ten non-blank characters, recorded with the admin's name; offered on the admin booking page. Browser: dialog, disabled without a reason, server records it |
| P0-7 | Evidence: coordinates, another partner's rows, raw upload row, evidence after the job, an earlier partner's photos counted as proof | FIXED | Coordinates admin-only; offered partner gets none; holder reads and is credited only with their own rows; upload answers with a receipt; no upload once the job is over; `replace` touches only the uploader's rows; a client-supplied storage key must belong to the booking. `partner-boundary.integration.test.ts` (15), `evidence-by-holder.integration.test.ts` (4) |
| P0-8 | Customer's note and access details missing from the job page | FIXED, browser | Shown while the job is held; absent at offer and after completion |
| P0-9 | Navigation not bound to the job | FIXED, browser | `/navigation?booking=<id>` |
| P0-10 | Offer had no detail and its panels 404'd | FIXED, browser | Offer card shows scope; the offered job page fires no refused read |
| P0-11 | Chat readable after the job; text kept in notifications; a later partner read the earlier partner's conversation | FIXED, browser for the closed state | Open only while the job is active; notification without text; a partner reads the customer's messages from when they took the job (acceptance or hand-over, whichever is later) |
| P0-12 | An available partner unmatchable for part of every cycle | FIXED in code, NOT verified on a device | Location with every heartbeat and a re-read of an old fix. A headless browser with a fixed position never yields a second reading (measured: every later read times out), so the browser run moves the position every 8 s. An earlier note here that the journey passed "with a stationary partner" was wrong: that pass came from page navigations restarting the watcher |

## P1 — publish governance and lifecycle

| # | Item | Status | Evidence |
|---|---|---|---|
| P1-1 | Gates that could not fail | FIXED in part | Booking-policy gate fails with the platform policy it reports on; per-service wording is flagged as not enforced. Cancellation and refund still validate the single platform policy: there are no per-service terms (P3) |
| P1-2 | Safety, quality, materials, equipment passed on nothing | FIXED | Safety needs a prohibited condition and an incident protocol; quality needs a checklist item and a completion criterion; `NOT_SPECIFIED` is not a policy. All 25 live services already carry these (read-only count, 2026-10-06) |
| P1-3 | Edits to a live service ran a weakened gate | FIXED | `liveEditRegressions`, through update, revision apply, restore and "coming soon" |
| P1-4 | Direct inserts created live services | FIXED | **Migration `20261006190000_service_defaults_draft`: a new row is a draft.** Defaults only; no existing row is touched. Fixtures and scripts that need a service on sale say so explicitly; such a script is refused on a deployed environment; a test fails if a script inserts a service without saying. `catalog-governance.test.ts` (8). **The migration has to be deployed by the owner; it was applied only to the test database** |
| P1-5 | VALIDATING was a label | FIXED | The gate runs on entry; a failing service cannot be sent for review |
| P1-6 | A ₹0 variant passed | FIXED in part | `VARIANT_UNPRICED`; see Open 9 |
| P1-7 | `SERVICE_PUBLISH_REQUIRES` failed open on a typo | FIXED | An unrecognised name adds the deployed defaults |

No live service was paused or unpublished by any change here.

## Verification

| Check | Result |
|---|---|
| Full backend regression with the migration applied (before the second re-audit's fixes) | 4349 pass, 0 fail, 372 files |
| Full backend regression after the second re-audit's fixes | 4354 pass, 0 fail, 372 files |
| Backend typecheck, lint | exit 0, exit 0 |
| Customer web | 204 unit tests, typecheck and lint clean |
| Partner web | 171 unit tests, typecheck and lint clean |
| Admin panel | typecheck and lint clean |
| Two-browser journey (payment → offer → accept → arrival → PIN → steps → checklist → proof → complete) | 48 of 48, with the server-held position rule in force |
| Admin, customer booking page, partner job page | 22 of 22, 11 of 11, 4 of 4; 0 accessibility violations; no horizontal overflow |
| Public pages and admin waiver | 8 of 8: refund page equals the server's tiers; home, services and bookings carry no invented claim; waiver dialog |

The browser runs were made before the second re-audit's fixes (waiver bound to the partner, requirement check, chat hand-over cut, storage key, wallet / FAQ / support copy). Those have unit and integration evidence only.

## Open

Security and truth:

1. **A modified client can still author its own position.** Every position the server holds comes from the partner's device: the presence heartbeat validates range, clock and a 200 km/h jump limit, and nothing more. A client that sends heartbeats placing itself at the job and then calls `/arrived` is believed. What the new rule stops is the unmodified app arriving on a stale fix, on the job's coordinates, or from a place the tracked position contradicts. Real proof needs something the client cannot write: device attestation in the mobile apps, or corroboration by the customer at arrival (start already has the customer's PIN). **DECISION NEEDED.**
2. **GPS geofence arrival** (`tracking.service.ts`): two tracking pings carrying the job's coordinates record arrival without the check. Arrival is what a customer no-show is judged on.
3. **Any URL counts as photo proof.** The upload stores the link it is given. A real fix is a server-side upload to storage; the partner web sends the image itself (a data URL), the mobile apps were not checked. **DECISION NEEDED** (touches the mobile apps).
4. **Customer first name and address label** reach partners at offer stage and after completion (by the stage rule's design).
5. **A background tab or a failed position read** can leave an available partner stale; a paused partner holding a job sends no location. Not verifiable without a device.
6. **Legal pages** state refund timings and windows in their own words (list in the log below). The timings do have a server source (`walletNote`, `gatewayNote`); the legal text was not edited because it is the owner's.
7. **Knowledge base**: the seeder now carries the three corrected FAQ answers; a knowledge base already seeded from the old text still cites it until it is re-seeded.

Governance:

8. **Safety and quality accept any non-blank text** ("-"). The gate cannot judge prose; the second admin's approval is the control.
9. **A variant with no price of its own inherits the base or unit price**, and one branch hides a missing price behind an audience error.
10. **Coverage, availability and provider skills** are warnings unless the owner lists them as required.
11. **A host with neither `NODE_ENV=production` nor `APP_ENV` set** counts as a developer machine and requires no safety, quality or execution section.
12. **A service already in review can be edited into a failing state**; approval and activation still refuse it.
13. **Certification scripts that insert with raw SQL** (`phase-2-live-certification`, `stage-d-step-10/11/12`) now create inconsistent drafts (active flag set, lifecycle draft) and have no deployed-environment refusal. They will not work as written until updated.
14. **The ungoverned-service report** runs only as a script; no route, job or alert.
15. Service delete has no reason or audit entry; lifecycle and approval audit writes are not awaited; a PAUSED service approved with a schedule is never auto-activated.

Process:

16. `prisma generate` could not replace the engine DLL while the dev backends were running. The generated client carries the new defaults; run it again with the backends stopped.
17. The "another partner cannot read the job" test still uses a customer token.

## P2 — UX gaps that need no new business policy (not started)

Options vs variants naming, changing variant / quantity on `/book`, add-on quantity, detail-page quality and availability sections, media gallery, progressive disclosure, per-job earnings line, a selection summary on the customer booking payload.

## P3 — needs a product decision (not started)

Option groups, per-service capacity, per-service cancellation and refund terms, per-service provider earnings, media upload, per-service review moderation and analytics.

## Log

- 2026-10-06: tracker created from three read-only audits (customer, partner, admin).
- 2026-10-06: P0-1 … P0-11 and P1-1 … P1-6 fixed test-first; commit `714abee`.
- 2026-10-06: first adversarial re-audit: 21 findings, 6 fixed in `714abee`.
- 2026-10-06: owner approved four recommendations (server-held position with an admin waiver; draft by default; safety and quality minimum from the fields the job runs on; commit). Commits `2669680` (position, evidence, minimum), `72d91ad` (migration), `d3fec0d` and `b3d14b6` (customer web).
- 2026-10-06: browser runs on the isolated stack; second adversarial re-audit: 14 findings; waiver scope, requirement check, chat hand-over, evidence replace, storage key, wallet / FAQ / support copy fixed.
- Legal sentences left for the owner (`apps/web/src/lib/legal/legal-data.ts` lines 128, 168, 274, 281, 297, 309, 315; `lib/legal/content.ts` lines 59, 63; `app/legal/refund/page.tsx` metadata): refund "within 5–7 business days", "instant" wallet credit, "48 hours" to raise a quality dispute, "24 hours" to acknowledge a refund request, "72 hours / 30 days" for privacy requests, "rework guarantee".
- Support phone tile and "call back within 5 minutes" were removed from the customer web: the number shown and the number dialled differed, and the call-back sent nothing. A real number is needed before the tile returns.
