# Phase 12–14 tracker

Started 2026-10-06, after an item-by-item audit of the Phase 12–14 specification against the code showed that the earlier "closed" status was too strong. This file is the working list; `PHASE-12-14-FINAL-CERTIFICATION.md` defers to it.

**Status, 2026-10-07 (afternoon): P0 and P1 are fixed and verified on the current code; the phases are NOT CLOSED as a whole.** Two more adversarial re-audits ran today (the third and the fourth); every finding that could be fixed without a new business decision or a change to the mobile apps is fixed, and all evidence in "Verification" was produced after the last of those fixes. What keeps the phases from being closed is listed in "Open" and is of three kinds: (a) one limit no server-side change can remove — a position is whatever the partner's device reports (Open 1); (b) decisions and data only the owner can supply (Open 2–5); (c) known lesser gaps, each stated. The fixes made after the fourth re-audit have not themselves been re-audited (Open 12). P2 and P3 have not started. Nothing is pushed.

Statuses: **FIXED** (code and tests written, the evidence named ran green; "browser" where it was also driven in a browser), **OPEN**, **DECISION NEEDED**.

Rules for this work: existing ACTIVE services stay live; no missing business fact is invented; no new Prisma lifecycle enum; no second location, evidence, matching, booking, payment, audit or lifecycle system.

## P0 — trust, security, truth

| # | Item | Status | Evidence |
|---|---|---|---|
| P0-1 | Customer `/book`: fabricated metrics and badges | FIXED, browser | `booking-page-truth.test.ts`; journey step "no invented statistic or badge" |
| P0-2 | Cancellation terms hard-coded on `/book` and the refund policy page | FIXED, browser | Both render the server's policy; the journey and the public-page run compare the page with the server's tiers |
| P0-3 | Success dialog and booking status wording | FIXED, browser | "Payment received", "₹X paid online"; status follows payment and assignment |
| P0-4 | Summary and saved bookings named a made-up package or professional | FIXED | Server selection label; real professional name or "Professional not assigned yet" |
| P0-5 | Professional-preference selector did nothing | FIXED (removed) | The backend cannot honour a preference |
| P0-5b | Demo catalogue, wallet and profile data outside production builds | FIXED, browser | Opt-in flag only; a release build refuses it; `mock-data-opt-in.test.ts` scans every source file |
| P0-5c | Invented statistics, ratings, reviews, promo codes, "AI" and "verified" claims | FIXED, browser for home / services / bookings | `tests/truth/*` |
| P0-6 | **Arrival, start, on-site check and GPS-geofence arrival trusted coordinates in the request** | FIXED, browser | One rule for all four (`lib/arrival-position.ts`, `services/arrival-position.service.ts`): the presence fix the server holds for the partner's active session must have been **received** recently (the server's clock; a device cannot date a fix forward to keep it fresh, and a fix that was old when it arrived does not count), must be at the job, and a recent position on the tracking stream must not place the partner elsewhere. The geofence path (`tracking.service.ts`) records arrival only when this check passes; two pings carrying the job's coordinates no longer do. Mismatch → `LOCATION_MISMATCH` and a FAKE_ARRIVAL risk signal. `arrival-position.test.ts` (9), `arrival-server-position.integration.test.ts` (23). **Third and fourth re-audit:** the "second stream" was the `locations` row, which the heartbeat itself writes, so it could contradict nothing; it is now this booking's own tracking pings (`location_history`), which only the tracking channel writes. What is written down with an arrival, a start, a completion and every photo is the position the server held (or nothing), never the request's coordinates; a repeated start does not overwrite it. **What it does not do is in Open 1** |
| P0-6b | A device that cannot give a position | FIXED, browser | Two recorded exceptions, never the normal path, each a row in the booking's activity log naming who vouched and for which partner: the **customer** confirming the professional is at the door (`POST /api/bookings/:id/confirm-arrival`; a secondary link in the customer's booking detail), or an **admin** waiving the check with a reason. Neither passes to a partner who takes the job over; the geofence never uses them. **Third re-audit:** the exception was looked up after the request's coordinates were demanded, so it could not help the one case it exists for. It is now looked up first: a device with no position sends none and is let through on arrival, the on-site check and start (routes and partner web send `null`; the server's refusal says to ask the customer to confirm). Coordinates that are sent are still checked. An exception lasts 2 hours (customer) or 24 hours (admin) — `POSITION_EXCEPTION_*_MAX_AGE_SEC`, defaults the owner can change — after which the customer can confirm again; the customer's control comes back after a reassignment or the expiry |
| P0-7 | **A link or a client-supplied storage key counted as photo proof** | FIXED, browser | Evidence media is the image itself (`lib/job-evidence-media.ts`): the authenticated partner holding the job sends the photo, the server checks the bytes are a JPEG / PNG / WebP within 8 MB, stores it through the existing object storage under a key only the server writes (`ev1/<booking>/<partner>/<stage>/<uuid>`), and records the row. A link, a storage key or non-image bytes are refused (`EVIDENCE_MEDIA_INVALID`), on `/evidence` and on `/complete`. The quality, completion and step gates count only a row whose key was stored for that booking, that partner and that stage: no URL, legacy row, other partner's photo or other stage's photo counts. No upload once the job is over (`BOOKING_NOT_ACTIVE`). Only a server-stored key is ever signed for viewing. Partner web: the "paste a URL" box is gone. `job-evidence-media.test.ts` (9), `partner-boundary.integration.test.ts`, `evidence-by-holder.integration.test.ts`, `w2-d1-quality-authority*.test.ts`; journey steps "a link sent as evidence is refused", "the job's photos are held by the server", "after the job the partner cannot attach more evidence" |
| P0-7b | **Evidence integrity (third and fourth re-audit)** | FIXED, browser for the duplicate refusal | A photo must be a structurally real PNG / JPEG / WebP with dimensions (three magic bytes used to pass); HEIC is refused with "send JPEG or PNG". Each photo's SHA-256 is kept: the same picture is refused for another stage of the job and for another of the partner's jobs (`EVIDENCE_MEDIA_DUPLICATE`), under a per-partner and per-job lock. One row per photo; 12 photos a stage and 40 rows a job per partner (`EVIDENCE_LIMIT_REACHED`); an object whose row was not written is deleted. Readers other than an admin get a served route (`GET /api/bookings/:id/evidence/:evidenceId/media`, same reader rules as the list, `nosniff`), never a storage key, a `local://` URL or a signed storage link. Dispute cases count only server-stored media as proof; a URL is kept as a claim. `/complete` stores its photos for every service (they were dropped where there was no quality policy) and words each refusal correctly. `job-evidence-media.test.ts` (20), `evidence-integrity.integration.test.ts` (11), `p10-s11-cases.integration.test.ts`; journey step "the step's photo sent again as the completion proof is refused" |
| P0-7c | **Money on a device-reported position: the customer no-show fee** | FIXED in part — see Open 1 | The partner's own no-show report charges the 50% fee only when (a) the arrival was confirmed from a position, not vouched for by the customer or an admin, and (b) there is a door photo: stored by the server for that booking and partner, after the arrival, and stamped by the server with a held position at the job. Otherwise the no-show is recorded, the customer is refunded in full and the partner is told why (`feeWithheld: NO_DOOR_PHOTO` / `ARRIVAL_VOUCHED`); an admin who reviews it decides. This is corroboration a person can check in a dispute, not proof. `phase09-no-show-api.integration.test.ts` (16), `phase09-no-show.integration.test.ts` |
| P0-8 | Customer's note and access details missing from the job page | FIXED, browser | |
| P0-9 | Navigation not bound to the job | FIXED, browser | |
| P0-10 | Offer had no detail and its panels 404'd | FIXED, browser | |
| P0-11 | Chat after the job; text in notifications; an earlier partner's conversation | FIXED, browser for the closed state | |
| P0-12 | An available partner unmatchable for part of every cycle | FIXED in code, NOT verified on a device | A headless browser with a fixed position never yields a second reading, so the browser run moves the position every 8 s |

## P1 — publish governance and lifecycle

| # | Item | Status | Evidence |
|---|---|---|---|
| P1-1 | Gates that could not fail | FIXED in part | Cancellation and refund still validate the single platform policy: there are no per-service terms (P3) |
| P1-2 | **Safety, quality, materials, equipment: permissive cases** | FIXED | Each has an explicit state shown on the publish checklist. PASS needs real content (safety: a prohibited condition and an incident protocol; quality: a checklist item and a completion criterion). **Placeholder text does not count**: a dash, punctuation, "n/a", "none", "tbd", "test" and the like, or fewer than three letters or digits (`isMeaningfulText`). **NOT_APPLICABLE is a declaration with a reason**: `catalogConfig.notApplicableReasons.{safety,quality,materials,equipment}`, at least ten letters or digits and not a placeholder. The reason is part of the configuration, so the second admin approves it with the content (the approval is bound to the content hash) and the version history keeps it. Materials / equipment "not required" without a reason is refused; `NOT_SPECIFIED` is never a policy; the old quality "not applicable" tick declares nothing on its own. Admin editor: the four reason fields, with the rule explained. **Third re-audit:** the job-time code switched quality checks off on the bare tick while the gate asked for a reason; both now use one predicate (`declaredNotApplicable`: the switch and a real reason). A reason needs ten letters or digits, three different words, and one word that is not just the label ("not applicable", "n/a", "safety" …). The readiness shown on the admin row is derived from the gate itself, so it cannot say READY for a service the gate blocks. Ticking the switch no longer deletes the stored checklist. `service-publish-governance.test.ts` (117), admin `not-applicable-reasons.test.ts`, `service-config-editor.test.ts` |
| P1-3 | **Live-service edit, revision, scheduled apply and restore against the strict gate** | FIXED, verified | `liveEditRegressions`: a live service keeps the gaps it had and no change may add one. Verified on every route: direct edit, restore, a revision refused when proposed, a revision queued while allowed and refused at approval, the same revision refused by the scheduler at its time (reported as failed), and a compliant revision applied. **Third and fourth re-audit:** on a live service, real content could be swapped for a "not applicable" declaration, and protections could be taken off with no declaration at all (photo proof switched off, the warranty or complaint window shortened, safety or quality emptied where nothing is listed as required). All are now regressions (`*_DECLARED_NOT_APPLICABLE`, `QUALITY_PROTECTION_REDUCED`, `*_PROTECTION_REMOVED`) refused on every write path under both policies; the way to make such a change is pause, edit, publish again, which needs the second admin. How many lines a checklist has is not judged. `service-publish-governance.integration.test.ts` (37) |
| P1-4 | Direct inserts created live services | FIXED | Migration `20261006190000_service_defaults_draft`; scripts must ask for the flags and are refused them on a deployed environment |
| P1-5 | VALIDATING was a label | FIXED | |
| P1-6 | A ₹0 variant passed | FIXED in part | See Open 6 |
| P1-7 | `SERVICE_PUBLISH_REQUIRES` failed open on a typo | FIXED | |

No live service was paused or unpublished. On the developer database the 25 live services carry real safety and quality content (shortest entry 12 characters); **none of them has a materials or equipment policy set**, which the checklist shows as a warning on a live service and would block a first publish.

## Verification (all after the last fix of 2026-10-07)

| Check | Result |
|---|---|
| Full backend regression | 4482 pass, 0 fail, 374 files |
| Backend typecheck | Clean except two errors in `src/__tests__/broadcast-accept-gate-context.test.ts`, a file changed by something other than this work (see Open 13) |
| Customer web: unit tests, typecheck, lint | 216 pass, exit 0, clean |
| Partner web: unit tests, typecheck, lint | 173 pass, exit 0, clean |
| Admin panel: unit tests, typecheck, lint | 98 pass, exit 0, clean |
| Two-browser journey: pay → offer → accept → arrive → PIN → steps → checklist → proof → complete | 51 of 51. New step: the step's photo offered again as the completion proof is refused as the same photo; a new photo completes the job |
| Admin control plane | 22 of 22; 0 accessibility violations; no overflow at 390 / 1280 |
| Customer booking page, partner job page | 11 of 11, 4 of 4; 0 accessibility violations; no overflow at 320 / 390 / 768 / 1280 |
| Public pages and admin waiver | 8 of 8 on the second run; the first run stopped at the admin sign-in (the form was filled before the page was ready), which is the harness, not the product |
| Customer's confirm-arrival exception | 7 of 7: the five customer steps, then a partner signed in on a device with no location permission is recorded as arrived by the server after the customer's confirmation; 0 accessibility violations |
| Adversarial re-audits | Third: 15 findings. Fourth (after their fixes): 8 of 17 claims closed outright, 9 in part, 7 new defects; the ones fixable here were fixed afterwards and are covered by the runs above. Those fixes have not been re-audited |

Not driven in a browser: the admin editor's reason fields and the new "protection reduced" refusals (unit and integration tests only); the evidence "View" button against the served route.

## Migration `20261006190000_service_defaults_draft`: target and status

Read-only, 2026-10-07. Nothing here was changed by this work.

| Database | Where | State |
|---|---|---|
| `homigo_db` | local Docker `homigo-postgres`, `localhost:5433` — what `apps/backend/.env` points at | **Applied.** Recorded in `_prisma_migrations` (started and finished 2026-10-06 18:01:55 UTC, one step, no unfinished row); the four column defaults read DRAFT / false. It was not applied by this work: no command of this session was running at that time. Service rows are unchanged (25 live commercial services) |
| `homigo_test` | same server | Defaults applied by SQL for the test runs; no migration record (the test database is built from the schema, not from the migration history) |
| `homigo_staging_db` | local Docker `homigo-staging-postgres`, `localhost:5434` | **Not applied.** Its latest migration is `20260929200000`; it is two migrations behind |
| A deployed production database | — | None is reachable from this machine and none was looked for. Do not apply until its exact target is named |

`homigo_db` holds 154 migration records and the repository has 150 migration directories; that difference predates this work.

## Open

What no server-side change can close:

1. **A position is whatever the partner's device reports.** The server decides from what it holds, on its own clock, checks this booking's tracking pings against it, and writes down only what it held — and every one of those readings came from the partner's device. A client built to lie reports a consistent false position and is believed; a partner who sends no tracking pings is checked against one stream only. The door photo behind a no-show fee is whatever was in front of the camera. Closing this needs something the client cannot author: device attestation with a mock-location signal in the mobile apps. Until then the controls are the ones a person can check afterwards (the photo, the risk signal, the customer's dispute, an admin's review). **DECISION NEEDED** (mobile apps are out of scope).

Owner decisions and data:

2. **The 25 live commercial services have no materials or equipment policy.** Nothing on record says who brings what, so nothing was filled in. An admin sets each one in the service editor (provided by the customer / by the professional / included, or "not required" with a reason); until then the checklist shows a warning on the live service and a first publish would be blocked.
3. **The partner mobile app** sends photos as data URLs, which the new evidence rule accepts (read, not run). An iPhone photo in HEIC is refused with "send JPEG or PNG": the app has to convert or capture JPEG. It has no way to add a door photo before reporting a no-show, so on mobile a partner's own no-show report charges no fee until that is built. Its upload after completion is refused (the photo sent with completion is stored).
4. **The no-show fee rule is a change of behaviour**: fewer fees are charged automatically. The two exception lifetimes (2 h, 24 h), the evidence limits (12 a stage, 40 a job) and the 90-day window for "same photo on another job" are defaults chosen here, not business decisions on record.
5. **Legal pages** state refund timings and windows in their own words; the knowledge base cites the old FAQ text until it is re-seeded; the support phone tile is removed until a real number exists. Customer first name and address label reach partners at offer stage and after completion (by the stage rule's design).

Known lesser gaps:

6. Position: a partner whose phone reports a wrong position (rather than none) is refused even after the customer confirms, and must turn location off to use the exception; a job address with no coordinates is satisfied by any fresh fix; after an arrival the customer is not offered the control again, so a start more than 2 hours later with no location needs an admin's waiver; two simultaneous starts both write the start position (both server-held).
7. Evidence: the image check reads headers and does not decode (a file with a valid header and a broken body passes); one changed byte makes a "new" photo, so only lazy reuse is caught; photos stored before today have no hash; rating and dispute photos are still accepted on their first bytes alone; four 8 MB photos exceed the 25 MB request cap and are refused by the transport, not in the evidence wording; legacy rows (a URL, or a key the server did not write) no longer count as proof.
8. Publish gate: the text rules cannot judge whether a reason or a checklist means anything ("not applicable at all" passes; a two-word reason, or one in a script without spaces, is refused) — the second admin's approval is the control; a checklist can still be cut to one line on a live service; a variant with no price of its own inherits the base price; coverage, availability and provider skills are warnings unless listed as required; a host with neither `NODE_ENV=production` nor `APP_ENV` requires no section; a service in review can be edited into a failing state (approval still refuses it).
9. The stored `services.config_status` column is rewritten only on save (the admin row derives it live); `scripts/audit-service-configuration.ts` and two reporting scripts still use the older reads; certification scripts that insert with raw SQL create inconsistent drafts; the ungoverned-service report runs only as a script.
10. Service delete has no reason or audit entry; lifecycle and approval audit writes are not awaited; a PAUSED service approved with a schedule is never auto-activated.
11. P0-12 (an available partner unmatchable for part of every cycle) is fixed in code and not verified on a device.

Process:

12. The fixes made after the fourth re-audit (door-photo position, vouched arrival, server-held stamps on uploads, per-partner evidence lock, served route for all non-admins, `/complete` photos, protection reductions, the on-site check route) are covered by tests and the browser runs above but have had no adversarial re-audit. Each of the four so far found defects the tests had missed.
13. **Files changed by something other than this work, left untouched and not committed:** `apps/backend/src/__tests__/broadcast-accept-gate-context.test.ts` (rewritten at 12:28 IST with a byte-order mark and mis-encoded characters; two type errors) and `src/__tests__/helpers/adversarial-fixtures.ts` (same re-encoding, comments only); fifteen certification documents under `apps/backend/docs` (re-stamped at 11:10 IST).
14. Migration `20261006190000_service_defaults_draft` is applied on the developer database (not by this work) and not on staging; no production target is named.
15. The development backends were stopped for `prisma generate` and have not been restarted. Test runs leave uploaded photos under `apps/backend/uploads/job-evidence/ev1`; the folder was emptied after these runs.

## P2 — UX gaps that need no new business policy (not started)

Options vs variants naming, changing variant / quantity on `/book`, add-on quantity, detail-page quality and availability sections, media gallery, progressive disclosure, per-job earnings line, a selection summary on the customer booking payload, the confirm-arrival link on the home tracking card.

## P3 — needs a product decision (not started)

Option groups, per-service capacity, per-service cancellation and refund terms, per-service provider earnings, media upload, per-service review moderation and analytics.

## Log

- 2026-10-06: tracker created from three read-only audits. P0-1 … P0-11 and P1-1 … P1-6 fixed; commit `714abee`. First adversarial re-audit: 21 findings.
- 2026-10-06: owner approved four recommendations. Commits `2669680`, `72d91ad` (migration), `d3fec0d`, `b3d14b6`. Second adversarial re-audit: 14 findings; commit `e418891`.
- 2026-10-07 (not committed, by the owner's instruction): arrival and geofence integrity (server-clock age, second stream, geofence through the same check, customer confirmation as the recorded exception); proof-by-URL closed (server-stored images only); explicit Safety / Quality / Materials / Equipment states with declared reasons; revision / apply / restore verified against the strict gate; `prisma generate` with backends stopped; migration target and status recorded; every suite re-run on the resulting code.
- 2026-10-07, afternoon (owner approved the re-audit, the fixes and a commit; no push): third adversarial re-audit, 15 findings; fixes for position (exception first, the booking's own pings as the second stream, exceptions that expire, server-held stamps), the no-show fee (door photo), evidence integrity, and the publish gate (one predicate for gate and job, swaps and reductions on a live service, reason rule, readiness from the gate). Fourth re-audit: 7 new defects, fixed where possible. Regression, the three web suites and every browser run repeated on the result.
- Legal sentences left for the owner (`apps/web/src/lib/legal/legal-data.ts` lines 128, 168, 274, 281, 297, 309, 315; `lib/legal/content.ts` lines 59, 63; `app/legal/refund/page.tsx` metadata).
