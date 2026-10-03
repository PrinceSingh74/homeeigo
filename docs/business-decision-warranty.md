# Business decision — warranty / revisit operations

Status: **CONFIGURATION_ONLY_BY_DESIGN** for a Warranty/Revisit engine. Not required for production by any owner document in this repository.

## What exists

- Admin may set `catalogConfig.quality.warrantyDays` (0–3650).
- At job **complete**, if days > 0, the booking snapshot records `{ days, until }` (`warrantyWindow`).
- Historical bookings without a quality snapshot are not retro-gated.

## What does not exist

No `Warranty`, `WarrantyClaim`, `RevisitRequest`, or Resolution domain. Completing a job does not create a claim case, SLA, or automatic revisit assignment.

## Decision

Repository search found no product requirement to ship a revisit engine before release. Inventing tables and ops flows would be fake functionality.

- **If product later requires claims/revisits:** design Warranty → Claim → eligibility → evidence → ops decision → revisit assignment → resolution, with snapshots remaining immutable.
- **Until then:** `warrantyDays` is informational on the completed booking. Do not show a customer “warranty portal” that cannot file a claim.

This is not PARTIAL unfinished work pretending to be an engine. It is an explicit non-scope.
