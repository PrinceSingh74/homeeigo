# W2-D2 — Dispatch pin bypass · FROZEN

## Defect, as measured (worse than the Wave 1 audit reported)

`src/lib/dispatch-must-include.ts` shipped a hardcoded default mapping a personal e-mail — plus a
typo'd copy of it, with dedicated `gamil.com → gmail.com` correction code — to a personal phone
number, active on every host including production. The audit found the synthesis and the offer-time
bypass. Mapping every consumer found **five** bypass sites, one of which fabricated data:

| Site | What it did |
|---|---|
| assignment engine — ranking | synthesised the pinned partner as a match with `totalScore: 10_000`, never scored |
| assignment engine — fan-out | a pin forced broadcast dispatch mode |
| assignment engine — offer revalidation | a pinned partner could skip `OFFLINE, PAUSED, STALE_PRESENCE, STALE_LOCATION, LOCATION_INVALID, NOT_AVAILABLE, SCHEDULE_BLOCKED, OUTSIDE_WORKING_HOURS, BREAK_ACTIVE, OUTSIDE_SERVICE_AREA, LOCATION_REQUIRED, NO_CAPACITY, CAPACITY_LIMIT, CONFLICT, SKILL_MISMATCH` |
| booking accept | skipped the capacity/presence gate — and for `STALE_LOCATION`/`STALE_PRESENCE` **wrote `lastHeartbeatAt`/`lastLocationAt = now` into `partner_presence`**: fabricated presence |
| arrive **and** start | substituted the **job address** for the partner's GPS, so a partner nowhere near the job was recorded as arrived |

## Live exposure — honestly unmeasurable

`DISPATCH_MUST_INCLUDE` is not set on the live host, so the hardcoded default was what applied. The
pin's events (`dispatch_must_include_resolved`, `dispatch_must_include_offer_bypass`) were logged at
**INFO**, and the persisted application log retains **ERROR only** — 3,739 rows since 2026-08-19,
every one `level = error`. The absence of pin events there is therefore **not** evidence that the pin
never fired. Resolving the pinned identities on live would require decrypting customer PII to answer
a historical question whose answer does not change the fix, so that was not done.

## Fix — policy now matches the owner's rule exactly

- **No default.** `DEFAULT_DISPATCH_MUST_INCLUDE = {}`. No personal e-mail or phone anywhere in the
  pin code path; the typo-correction that existed only to match the hardcoded pin is removed.
- **Never on a deployed host.** `parseDispatchMustInclude` returns an empty map unless
  `devAffordancesAllowed()` — the canonical check, which is false for `NODE_ENV=production` *and* for
  `APP_ENV=staging` (whose `.env` ships `NODE_ENV=development`, so a NODE_ENV check would have leaked).
- **Soft preference only.** `preferPinnedAmongEligible(ranked, pinnedIds)` reorders partners that
  matching already admitted and **cannot add one**. A pinned partner who failed any hard gate is not
  offered.
- **Every bypass deleted, not disabled:** `mustIncludeMatch` (10,000-score synthesis), forced
  broadcast, the offer-time `pinnedOffer` path, the accept-time bypass **and its presence writes**,
  `applyMustIncludeProximityBypass` at arrive and start, `canBypassMustIncludeBlock`,
  `MUST_INCLUDE_BYPASS_BLOCKS`, `mergeMustIncludeFront`, `isMustIncludePinnedProvider`.
- A pin that influences ordering is logged (`dispatch_pin_preference`, with `pinned` vs
  `pinnedAdmitted` — the gap is exactly the pinned partners who failed hard eligibility).

## The existing test encoded the defect

`dispatch-must-include.test.ts` asserted, as intended behaviour, that the personal e-mail mapped to
the personal phone, that `OFFLINE`/`OUTSIDE_SERVICE_AREA`/`STALE_PRESENCE` were bypassable, and that
a pinned partner's missing GPS became the job address. It was **rewritten to assert the opposite**,
because the owner's D2 policy is the opposite. This is recorded so the rewrite cannot be mistaken for
a test relaxed to go green.

## Evidence

| Suite | Result |
|---|---|
| `dispatch-must-include.test.ts` (rewritten) | **19 / 19** |
| 14 dispatch / assignment / accept / offer-liveness / concurrency / chaos suites | **123 / 123** |
| `tsc --noEmit` | clean |

Cases: default empty · no personal data in four files · absent variable = no preference · deployed
host resolves every pin to nothing even with the variable set · dev host honours an explicit map ·
malformed config = no preference · pinned+eligible moves first · **pinned+ineligible is not offered**
· output never longer than the eligible input · deterministic order · no bypass API exported · no
synthesis · no forced broadcast · no offer bypass · **no presence write at accept** · no GPS
substitution at arrive or start.
