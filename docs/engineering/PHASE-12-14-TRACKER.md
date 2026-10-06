# Phase 12–14 tracker

Started 2026-10-06, after an item-by-item audit of the Phase 12–14 specification against the code showed that the earlier "closed" status was too strong. This file is the working list. The certification document is corrected from it once P0 and P1 are verified.

Statuses: **OPEN**, **FIXED** (code and tests written, the evidence named ran green), **VERIFIED** (re-audited after the fix, and driven in a browser where the item is a screen), **DECISION NEEDED**.

Rules for this pass: existing ACTIVE services stay live; no missing business fact is invented; no new Prisma lifecycle enum; no second booking, matching, payment, refund, execution, audit or capacity engine. P2 and P3 do not start until P0 and P1 are verified.

**P0 and P1 are NOT verified as a whole.** Each row marked FIXED has the evidence named and was driven in a browser where it is a screen, but an adversarial re-audit after the fixes found further defects (section "Re-audit"). Some were fixed the same day; the rest are open. P2 and P3 have not started.

## P0 — trust, security, truth

| # | Item | Status | Evidence |
|---|---|---|---|
| P0-1 | Customer `/book`: fabricated metrics, "Best Seller" on every service, "Featured", "Most Popular" on a price tier | FIXED | Stats removed; "Popular" only when the catalogue's own `isPopular` flag is set; "Selected" on the chosen card; tier tags removed. `apps/web/tests/booking/booking-page-truth.test.ts` |
| P0-2 | Customer: cancellation card showed hard-coded 100 / 90 / 75 % | FIXED | The card renders `GET /api/bookings/cancellation-policy` (the server has two customer tiers, 100 % and 75 %: the 90 % row was a stale claim). No numbers while loading or on error. `cancellation-policy.test.ts` |
| P0-3 | Customer: success dialog said "payable at service" after an online payment, and "cancel anytime" | FIXED | "₹X paid online"; "Cancellation terms apply". The dialog has one caller, after the server verifies payment |
| P0-4 | Customer: summary and saved booking named a price tier when a variant / quantity selection was priced; every server-loaded booking showed package "Standard" and "Assigned Pro" | FIXED | Summary shows the server's selection label and price. Server-loaded bookings show the real professional's name or "Professional not assigned yet", and no package name (the customer booking payload carries no selection summary: see P2). `booking-summary.test.ts`, `booking-display.test.ts` |
| P0-5 | Customer: professional-preference selector did nothing | FIXED (removed) | The backend cannot honour a preference (`PROFESSIONAL_PREFERENCE_SUPPORTED = false`: assignment cannot filter on it), so the control is removed rather than faked |
| P0-5b | Customer: a ₹0 "Standard" tier and "Live catalog is syncing" placeholder were shown while the catalogue loaded or failed; demo catalogue with prices and warranty lines in non-production builds; a real service inherited another entry's tagline and price | FIXED | `/book` renders nothing bookable until the catalogue is loaded; commercial fields come only from the API (`apps/web/src/lib/book-services.ts`). `book-services.test.ts` |
| P0-5c | Customer: "Verified Professionals" chip; invented prices and "most popular" claims in the assistant sheet | FIXED | Reworded to "Approved Professionals" (every dispatchable partner is approved; identity verification is required only where a service asks for it). Assistant replies carry no figure |
| P0-6 | Partner: "I'm at the customer" submitted the job's own coordinates as the partner's GPS, and a saved fix was pinned forever | FIXED (client) / OPEN (server) | The option and pinning are removed; a remembered fix always expires; a presence fix keeps its capture time. `apps/partner-web/tests/arrival-position.test.ts`. **Open:** `/arrived` and `/start` still judge coordinates the client claims; the server does not compare them with the presence fix it holds, and a soft read can be up to 30 minutes old |
| P0-7 | Partner: evidence list returned coordinates after the job, and an earlier partner's evidence to a partner only offered the job | FIXED | Coordinates are admin-only; an offered partner gets an empty list; the partner holding the job reads only their own rows. `partner-boundary.integration.test.ts` |
| P0-8 | Partner: customer's note missing from the job detail; landmark, flat, building and access instructions sent but never shown | FIXED | `description` on the partner detail, by stage; a labelled list on the job page. Same suite; `job-access.test.ts` |
| P0-9 | Partner: no navigation from the job; `/navigation` picked the first active job | FIXED | "Navigate" on the job page → `/navigation?booking=<id>`, which routes only to that job; external maps link works without a Maps key. `job-navigation.test.ts` |
| P0-10 | Partner: an offer had no detail link and its brief panels answered 404 | FIXED | Offer card shows scope and what to bring, and links to the job page; for an offer the page renders the brief from the booking payload and does not call the owner-only reads. `job-stage.test.ts` |
| P0-11 | Partner: chat readable after the job | FIXED | Chat is open while the booking is in an active fulfilment status (the rule the masked phone and the note already follow). After it the partner cannot read or send, nobody can send, and the customer keeps their copy. `partner-boundary.integration.test.ts` |

## P1 — publish governance and lifecycle

| # | Item | Status | Evidence |
|---|---|---|---|
| P1-1 | Gates that could not fail | FIXED in part | Booking policy now fails with the platform policy it reports on. Per-service cancellation / refund wording produces a warning that says it is not enforced. **Unchanged, by design:** cancellation and refund validate the one platform policy every booking freezes — there are no per-service terms to validate (P3); duration cannot fail because the API and a database CHECK refuse a non-positive duration before the gate is reached |
| P1-2 | Safety, quality, materials, equipment passed on an empty object, "not applicable" or `NOT_SPECIFIED` | FIXED | A gate passes on content: `hasSafetyContent`, `hasQualityContent`; `NOT_SPECIFIED` is the absence of a policy. `service-publish-governance.test.ts` |
| P1-3 | Edits, revision applies and restores on a live service ran a weakened gate | FIXED | `liveEditRegressions`: a live service keeps the gaps it had, and no edit may add one. Removing or emptying safety / quality / the work plan is refused; restore is refused the same way; an unrelated edit to a service that never had them still saves. Clearing "coming soon" (visible → bookable) is treated as a publish: full gate and a second admin. `service-publish-governance.integration.test.ts` |
| P1-4 | Seed scripts and direct database writes create live services | FIXED where application code can act / DECISION NEEDED for the rest | `seed-services` and `seed-popular-services` refuse a deployed environment. `catalogService.ungovernedLiveServices()` and `scripts/check-service-governance.ts` (read-only) report customer-visible services with no published version row. `catalog-governance.test.ts`. A read-only count on the live database on 2026-10-06 found all 25 commercial live services have a version row. **Not done:** the schema still defaults a new row to ACTIVE, and no database constraint ties visibility to the gate — changing either needs a migration, and several hundred test fixtures rely on the default |
| P1-5 | VALIDATING was a label | FIXED | Entering VALIDATING runs the gate and returns what it found; a service that fails cannot be sent for review. Same integration suite |
| P1-6 | A ₹0 variant passed the variant gate | FIXED | `VARIANT_UNPRICED` for every active variant the resolver cannot price (not on a coming-soon service). Pure suite |

Existing live services: none is unpublished or paused by any change here. A stricter rule applies to a first publish and to what an edit adds; a gap a live service already has stays a warning.

## Verification after the fixes (2026-10-06)

| Check | Result |
|---|---|
| Full backend regression | Run 1, after the P0 / P1 fixes: 4322 pass, 0 fail (369 files, 646 s). Run 2, after the re-audit fixes: 4325 pass, 2 fail (369 files, 711 s). Both failures are in `split-refund.integration.test.ts` (crash-safe gateway refund: the recovery sweep found its row already claimed); refund code was not changed, the customer-web typecheck and lint were running on the same machine at the time, and the suite run alone passed 11 of 11 twice. It was not proven to be load-related, and the full suite was not run a third time |
| Backend typecheck, lint | exit 0, exit 0 |
| Customer web: unit tests, typecheck, lint | 148 pass, exit 0, exit 0 |
| Partner web: unit tests, typecheck, lint | 171 pass, exit 0, exit 0 |
| Admin panel: typecheck | exit 0 (no source change this round) |
| Two-browser journey on the isolated stack | 47 of 47 steps, with the partner's position never changing. New steps: no invented statistic or badge on `/book`; cancellation terms equal the server's tiers; "paid online"; offer card has no customer note; offered job page explains the stage, fires no refused read, shows no street address, phone or navigation; the note appears once the job is held; Navigate carries this booking's id; no "at the customer" option; after the job the page says chat is closed; the partner's evidence list has no coordinates; the server answers `CHAT_CLOSED` |
| Admin browser run | 22 of 22 |
| Customer booking page and partner job page runs | 11 of 11, 4 of 4; 0 accessibility violations; no horizontal overflow |

The browser runs were made before the re-audit fixes below (evidence upload receipt, chat scope, notification text, required-sections parsing, search price). Those have integration and unit evidence only.

## Found by the browser run and fixed

- **An available partner was unmatchable for part of every cycle.** The partner web attached a location to every third heartbeat (75 s apart) while the server treats a fix as fresh for 60 s from its capture time, and the fix sent was whatever the position watcher last reported. Dispatch rejected the on-duty partner as `PRESENCE_STALE`. Now: a location with every beat, and a fix older than 30 s is read again from the device first (`apps/partner-web/src/lib/presence-cadence.ts`, `tests/presence-location.test.ts`). Evidence: the journey passes with a position that never changes; before, it passed only when the harness moved the position every 8 s.

## Re-audit (adversarial, read-only, after the fixes)

Held: the cancellation card; the success dialog's payment line; no partner-web path sends coordinates that did not come from the device; evidence listing; the note's stage rule on every partner payload and on offer notifications; chat routes; the offered job page; navigation by booking id; the live-edit rule through update, revision apply, restore, the on/off toggle and "coming soon"; no other writer of a service's configuration or lifecycle exists in `src`.

Fixed after the re-audit (integration / unit evidence, not yet re-driven in a browser):

| Finding | Fix | Evidence |
|---|---|---|
| `POST /api/bookings/:id/evidence` returned the raw row (coordinates, raw links, storage key), and its idempotency lookup returned an earlier partner's row for the system ids (`arrive:<booking>`) | The upload answers with a receipt (id, stage, times, upload id); another partner's row is neither returned nor reused | `partner-boundary.integration.test.ts` |
| The first 120 characters of every chat message were stored as a notification that outlives the closed chat | The notification says a message arrived, without its text | same suite |
| The conversation belongs to the booking, so a partner who took over a job read what the customer wrote to the earlier partner | A partner reads their own messages and the customer's from the time they took the job (`acceptedAt`); with no such time, only their own | same suite |
| A typo or a wrong separator in `SERVICE_PUBLISH_REQUIRES` silently required nothing | Any separator is accepted; an unrecognised name adds the deployed defaults instead of being dropped | `service-publish-governance.test.ts` |
| `configStatus` read READY for a service whose materials policy is `NOT_SPECIFIED` | `catalogConfigGaps` reads it as unspecified, like the gate | same suite |
| `/book` search printed "From ₹0" for an unpriced service, and said "No services match" before the catalogue had answered | Lowest server price or nothing; the message waits for the catalogue and suggests no searches of its own | `apps/web/tests/booking/search-price.test.ts` |

## Open after the re-audit

Security and truth (P0 level):

1. **Arrival and start accept any position the client claims.** The server checks only the distance between the claimed coordinates and the job address; it does not compare them with the presence fix it holds, the request carries no capture time, and a job address without coordinates passes any position. The holder's payload contains the job's exact coordinates, so a modified client can arrive from anywhere. The partner web no longer fabricates a position, but that is not enforcement. Needs a server rule (compare with the presence fix and its age) — and a decision on what happens to a partner whose device cannot give a fix.
2. **A partner can still arrive on an old fix.** "Use last saved GPS" may send a presence fix up to 30 minutes old (15 in strict mode); a presence fix with no capture time is treated as new.
3. **Quality and execution gates count any partner's evidence for the booking**, so a partner who takes over a job can complete on photos the earlier partner took.
4. **Evidence can be added after completion** (no status check on upload).
5. **A background tab or a failed position read** can still leave an available partner stale for part of a cycle (the interval doubles to 50 s in the background; a failed read sends the old fix).
6. **Customer web, other surfaces:** "4.9 rating", "Verified Pro / Background-checked" and counts on the home page; static service lists with prices, static five-star reviews and a hard-coded promo code when the API list is empty; the legal refund page states tiers (12 h free / 25 % / 50 %) that differ from the policy the server applies (24 h free / 10 % / 25 %); "5–7 days" refund timing; the success dialog says "Booking confirmed!" before any professional has accepted.
7. **`/book`:** trust chips and payment sentences are client constants shown even when the catalogue fails; "Basic / Standard / Premium" name three price points the server does not describe; a service with no variant or quantity rule is summarised and saved as "Standard Package".

Governance (P1 level):

8. **Safety and quality accept any non-blank text** ("-", "n/a") and quality passes on `proofRequired` alone. The gate cannot judge prose; a minimum that is not arbitrary needs a product rule.
9. **A variant with no price of its own can inherit the base or unit price**, and in one branch an audience error hides the missing price, so `VARIANT_UNPRICED` does not fire.
10. **Safety and quality are required only where the owner's list says so**, which on a developer machine is nowhere. By design; recorded so it is not mistaken for enforcement.
11. **A service already in review can be edited into a failing state** and stays in review. It cannot go live: approval and activation re-run the gate.
12. **Scripts still insert live services directly**: `seed.ts`, `phase-2-live-certification.ts`, the smoke / ecosystem / razorpay scripts, and the stage-d certification scripts (staging by design). Only the two catalogue seeds are guarded.
13. **The seed guard reads the process environment**, so an unknown `APP_ENV` (uat, preprod) or a laptop pointed at a production database is not refused.
14. **The ungoverned-service report has no route, job or alert**; it runs only when someone runs the script. A service that once had a published version and was later altered by SQL is not reported.
15. The schema default (a new row is ACTIVE) and the absence of a database constraint are unchanged: DECISION NEEDED (migration; several hundred fixtures rely on the default).

Carried from before: service delete has no reason or audit entry; lifecycle and approval audit writes are not awaited; a PAUSED service approved with a schedule is never auto-activated; the "another partner cannot read the job" test uses a customer token; the customer booking payload has no selection summary.

## P2 — UX gaps that need no new business policy (not started)

Options vs variants naming, changing variant / quantity on `/book`, add-on quantity, detail-page quality and availability sections, media gallery, progressive disclosure, per-job earnings line.

## P3 — needs a product decision (not started)

Option groups, per-service capacity, per-service cancellation and refund terms, per-service provider earnings, media upload, per-service review moderation and analytics.

## Log

- 2026-10-06: tracker created from three read-only audits (customer, partner, admin).
- 2026-10-06: P0-1 … P0-11 and P1-1 … P1-6 fixed test-first.
- 2026-10-06: browser runs on the isolated stack; presence cadence defect found and fixed; journey 47 of 47 with a stationary partner.
- 2026-10-06: adversarial re-audit; six findings fixed, fifteen recorded as open above. Status: NOT CLOSED.
