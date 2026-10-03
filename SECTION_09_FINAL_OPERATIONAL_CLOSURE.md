# HOMEEIGO PARTNER OS — SECTION 09 FINAL OPERATIONAL CLOSURE

## Executive Result

**CONDITIONAL PASS.**

Every warning carried out of the implementation pass has been classified and either closed with
working code or documented with the reason it cannot be closed. Three of the five turned out to be
real defects rather than cosmetic gaps, and the largest of them — notification preferences that were
written but never read — had been silently broken for both partners and customers.

It is not a FULL PASS. Four gates could not be executed in this environment and one pre-existing
defect outside Section 09 was found during regression. Both are itemised below rather than rounded up.

---

## Warning classification

| # | Warning | Verdict | Outcome |
|---|---------|---------|---------|
| 1 | Settings UI writes legacy `User` booleans | **REAL DEFECT** | Fixed — canonical bridge + rebuilt partner UI |
| 2 | Booking imperative notifications | **NOT DUPLICATING TODAY, LATENT RISK** | Risk closed by auto-retirement guard |
| 3 | All Section 09 workflows SHADOW | **CORRECT BY DESIGN** | Verified and now test-enforced |
| 4 | `demand.spike` has no producer | **POLICY PENDING** | Confirmed, documented, not fabricated |
| 5 | `ESCALATION` not executable | **PLATFORM LIMITATION** | Confirmed; made visible to operators |

---

## Warning 1 — Notification preferences (Phases 1–3)

### What was actually wrong

Two preference systems had drifted into each other's blind spot.

`PUT /api/users/preferences` wrote four booleans onto the `User` row. The notification router
decides channel eligibility from the `NotificationPreference` table, which **no client had ever
written a row to**. A grep for readers of the legacy columns found:

| Column | Written by | Read by | Real effect |
|--------|-----------|---------|-------------|
| `emailNotifications` | both settings UIs | nothing | **none** |
| `smsNotifications` | both settings UIs | nothing | **none** |
| `notificationsEnabled` | both settings UIs | nothing | **none** |
| `pushNotifications` | both settings UIs | `devicePushService.getActiveTokens` | over-broad (below) |

A partner or customer who turned off "Email alerts" kept receiving email. The toggle saved, the
screen showed the new state, and nothing changed.

`pushNotifications` was the opposite failure. It *was* read — but one layer below the router, in
`getActiveTokens`. Returning `[]` removed PUSH from the recipient's targets before
`evaluatePreference` ran, so push was suppressed for **every** category including SECURITY, which
`preferences.service` guarantees cannot be refused. A recipient who once turned push off stopped
receiving sign-in and safety pushes, and the router had no way to see the channel in order to
overrule it.

### What was changed

- **`notifications/legacy-preference-bridge.ts`** (new). Translates the legacy booleans into
  canonical `NotificationPreference` rows on every write. Two rules make it safe:
  - **OPTIONAL only.** A legacy flag is a statement about a channel, and OPTIONAL is the only
    category a recipient may refuse. Mandatory categories are never written — not `true`, not
    `false` — because a row for them would imply a choice that does not exist.
  - **Restrict-only.** Turning a flag *off* writes an explicit opt-out; turning it back *on* deletes
    the row so the platform default applies. An explicit `true` would outrank the category default
    and start sending OPTIONAL email and SMS to everyone who ever opened the settings screen, since
    both UIs default their toggles to on.
- **`device-push.service.ts`** — `getActiveTokens` gained `includeOptedOut`. The legacy default is
  unchanged for the imperative path, which has no governance of its own.
- **`recipient-resolver.ts`** — asks for capability, not permission. Push now appears as a target
  whenever a device exists, and `evaluatePreference` makes the policy call with correct
  mandatory-category semantics.
- **`push.adapter.ts` → `notification.service.ts` → `push-delivery.service.ts`** — the router's PUSH
  adapter passes `preferenceAlreadyApplied`, so the legacy boolean cannot overrule a decision the
  router already made.
- **`notifications/channel-availability.ts`** (new). Resolves what a recipient can actually be
  reached on, from the same facts the adapters use.
- **`GET /api/notifications/preferences`** now returns a complete, render-ready matrix — every
  (channel, category) cell, resolved through `evaluatePreference` itself, with `editable`,
  `mandatory`, `available` and an `unavailableReason`.
- **`PUT /api/notifications/preferences`** returns **422** on a refused mandatory disable. It
  previously returned 200 with `success: false`, so a client checking only the status code would
  show the toggle as saved.

### Partner UI (Phase 2)

`SettingsCenter` no longer writes booleans. `NotificationPreferencePanel` renders the server matrix,
grouped by category with mandatory groups marked "Always on" and locked.

On the channel list the prompt asked for, the honest answer differs from the request:

| Channel | Shown? | Why |
|---------|--------|-----|
| In-app | yes | always available |
| Push | yes | disabled with "No device registered" when no token exists |
| Email | yes | disabled when the provider is unconfigured or no address is on file |
| SMS | yes | disabled unless `SMS_ENABLED` and `AUTOMATION_SMS_ENABLED` are both on |
| **WhatsApp** | **no** | **no adapter, no credentials, no `NotificationChannel` value — nothing to expose** |

On the nine product categories (JOB / PAYMENT / SAFETY / TRAINING / KYC / INCENTIVE / ACCOUNT /
SYSTEM / GROWTH): `NotificationCategory` has exactly three values — TRANSACTIONAL, SECURITY,
OPTIONAL. The nine are notification *types*, not categories, and they all resolve into those three.
Rendering nine independent switches would be a lie in both directions: JOB and PAYMENT are both
TRANSACTIONAL and neither can be disabled, so the switches would not work. Per-type granularity
needs a schema change and a policy decision about which product categories become refusable.
**Recorded as POLICY PENDING; not faked in the UI.**

### Customer UI (Phase 3)

Left on the legacy endpoint deliberately — it now works, because the bridge sits behind it, and
rewriting a working customer screen was unnecessary risk. The descriptions were corrected: the card
claimed the SMS switch governed "OTPs and critical booking alerts" and the email switch governed
"booking confirmations, receipts". It governs neither. Copy now describes optional messaging, with a
line stating that confirmations, receipts, service updates and security codes are always sent.

Partner and customer preferences remain isolated: every row is keyed by `userId`, and partner
recipients resolve through `Provider.userId`.

### Verified against the live database

`scripts/verify-preference-chain.ts` exercises UI → API → table → router on the real database and
restores what it found:

```
PASS  OPTIONAL/EMAIL with no preference           SYSTEM_DEFAULT:false
PASS  OPTIONAL/PUSH after legacy opt-out          EXPLICIT_PREFERENCE:false
PASS  TRANSACTIONAL/PUSH after legacy opt-out     MANDATORY_CATEGORY:true
PASS  SECURITY/SMS after legacy opt-out           MANDATORY_CATEGORY:true
PASS  OPTIONAL/PUSH after re-enabling             CATEGORY_DEFAULT:true
PASS  re-enabling leaves no explicit row          0
PASS  bridge writes no mandatory rows             0

7/7 checks passed
```

---

## Warning 2 — Booking imperative notifications (Phases 4–5)

### There is no duplicate today

`booking-live.service` sends three notifications imperatively: BOOKING_ACCEPTED to the customer,
BOOKING_CANCELLED to the provider, and a "Service Complete / please rate" to the customer. No
notification template is registered for any of those three types, so the router cannot produce them
and **no message is currently sent twice**. Migrating them would not be a migration — it would be
new product surface, changing TRANSACTIONAL real-time delivery semantics, and it belongs to its own
certification rather than this one.

### The real risk was latent, and it is now closed

`review_request` is the dangerous case. The legacy path is live: `automation-scheduler.v1` enqueues
`automation.review_request` two hours after a booking completes, and the handler calls
`notificationService.sendNotification` directly — past the router, so it has never been subject to
quiet hours, cooldown, the daily cap or the customer's preferences. The replacing workflow does the
same job through governance and its templates are already activated.

Nothing prevented both from sending. The registry comment acknowledged that retiring the legacy path
is "a separate, deliberate act", but nothing made that act *required*: certifying the workflow LIVE
would have given every completed booking two review requests, one of them ungoverned.

**`automation/registry/legacy-path-guard.ts`** closes it. A replacement workflow already declares
`metadata.replaces`; the legacy path now asks whether a LIVE workflow claims it and stands down if
so. The check is applied twice — at enqueue in the scheduler consumer, and again in the job handler,
because jobs are scheduled two hours ahead and certification would otherwise leave a two-hour tail
of already-queued legacy sends. It reads the same in-memory registry that
`startWorkflowInstance` pins execution mode from, so guard and engine cannot disagree.

Certifying the workflow now retires its predecessor in the same act.

---

## Warning 3 — Shadow and live safety (Phases 6–8)

Verified across every workflow in the platform, not only Section 09's:

- No workflow resolves to LIVE. The test asserts the **effective** mode (`executionMode ?? "LIVE"`),
  not the declared one — checking only for an explicit `"LIVE"` would have passed while an omission
  did the opposite.
- That omission existed. `engine_selftest` was the one definition with no `executionMode`, so the
  engine's `?? "LIVE"` default applied to it. It has no notification or action step so nothing was
  sent, but "no workflow is accidentally LIVE" should be something the definitions state rather than
  something a reader reconstructs from a fallback three files away. Now explicitly SHADOW / DRAFT.
- No workflow declares `certificationStatus: CERTIFIED`.
- Every workflow names an owner, so a live action would be attributable. `engine_selftest` did not;
  it now declares `owner: "platform"`.
- The registry throws at registration on LIVE-without-CERTIFIED, and on a workflow whose declared
  `riskClass` is lower than its steps imply.

Nothing was activated in this pass.

---

## Warning 4 — `demand.spike` (Phase 14)

**POLICY PENDING. No producer written.**

`PARTNER_ZONE_SURGE_DETECTED` exists, the `surge_alert` workflow is registered in SHADOW, and the
trigger is wired — the path is real and inert. The missing piece is the threshold and hysteresis
that decide what constitutes a surge, which `surgeAlertPolicy` records as UNSET. That is a business
decision, and no approved policy was found in the codebase.

`surge-alert.integration.test.ts` scans the source tree and asserts no producer exists. The type,
workflow and trigger stay registered; the producer does not get invented.

---

## Warning 5 — `ESCALATION` (Phase 15)

**HUMAN ESCALATION REQUIRED. Not automated, and not claimed to be.**

`capability-fingerprint.ts` records `ACTION: false` and `ESCALATION: false`, the step executor fails
closed at `NOT_IMPLEMENTED` rather than recording an imagined success, and the fingerprint
invalidates prior certifications if either flips. That is correct behaviour and was left alone.

What was missing was operator visibility. A workflow with an ESCALATION step looked complete in the
Automation Center, and an operator certifying it would have had no way to know it would run to
completion having escalated nothing. `getOverview` now returns `unexecutableSteps` per workflow and
the console shows "N steps not executable" against each one.

Section 09's SOS path is unaffected: it uses the existing `opsAlert` and imperative admin
notification, not an ESCALATION step.

---

## Events, security and privacy (Phases 16–22)

| Gate | Result |
|------|--------|
| PII-safe payloads | PASS — `assertNoProhibitedPii` / `sanitizeEventPayload` enforced in tests |
| Event authorization | PASS — every privileged `partner.*` event is emitted from a backend domain service; no frontend producer |
| Envelope & versioning | PASS — `validateEventEnvelope`, version on every canonical event |
| Outbox atomicity | PASS — `emitInTransaction` shares the business transaction |
| Consumer idempotency | PASS — consumers keyed on event id; scheduler dedupes on `triggerEventId` |
| DLQ + bounded retry | PASS — `maxAttempts: 3`, dead letters visible and replayable from the console |
| Replay | PASS — `replayDeadLetterById`, audited to `ActivityLog` |
| Correlation | PASS — `eventId` / `correlationId` / `causationId` carried through instance and notification decision records |

---

## Performance (Phase 31)

No polling under 8 seconds anywhere in the platform. The Automation Center refetches at 30s. Every
automation list endpoint is server-capped at 100 rows (`Math.min(limit, 100)`) regardless of what
the client asks for, so there is no unbounded DLQ, outbox or instance fetch.

---

## Test and build results

Run serially — Bun 1.3.14 on Windows segfaults at exit when given multiple test files at once.

| Suite | Result |
|-------|--------|
| `section09-closure.integration` | **10 / 10 pass** (new) |
| `section09-events-automation.integration` | 11 / 11 pass |
| `verify-preference-chain` (live DB) | **7 / 7 pass** (new) |
| `partner-acquisition-automation` | 10 / 10 pass |
| `p0-blockers` | 10 / 10 pass |
| `p0-security-hardening` | 39 / 39 pass |
| `p1-security` | 3 / 3 pass |
| `p3-security` | 4 / 4 pass |
| `admin-rbac-routes` | 10 / 10 pass |
| `ws-channel-access` | 1 / 1 pass |
| `partner-acquisition` | 20 / 20 pass |
| `partner-lifecycle-fsm` | 6 / 6 pass |
| `partner-availability-fsm` | 18 / 18 pass |
| `section03-job-action-policy` | 4 / 4 pass |
| `section03-job-proximity` | 4 / 4 pass |
| `section04-incentive.integration` | 2 / 2 pass |
| `section05-trust-pure` | 11 / 11 pass |
| `section05-trust.integration` | 3 / 3 pass |
| `section08-ai-governance` | 6 / 6 pass |
| `vision-shadow` | 17 / 17 pass |
| `section07-referral.integration` | **4 pass / 1 fail** — see below |
| `surge-alert.integration` | **not executable** — requires isolated `homigo_p39` database |
| `chaos-certification` | **not executable** — environment-gated, 0 tests ran |

| Build gate | Result |
|-----------|--------|
| Backend typecheck | PASS |
| Partner Web typecheck | PASS |
| Customer Web typecheck | PASS |
| Admin typecheck | PASS |
| Prisma migrate status | PASS — 96 migrations, schema up to date, **no new migration needed** |

---

## Pre-existing defect found during regression (Section 07, not fixed here)

`section07-referral.integration.test.ts` fails on
`Unique constraint failed on the fields: (bank_account_number_hash)`.

It is not flaky and not caused by this work. `Provider.bankAccountNumberHash` is declared `@unique`,
so **two providers can never hold the same bank hash** — which means the `BANK_REUSE` signal in
`partner-referral-abuse.service` can never fire for a bank account in production either. The test
tries to set up the exact state the schema forbids. `scripts/section07-live-cert.ts` already knows
this and wraps the second write in a try/catch, recording `bankWriteBlocked`.

Resolving it means deciding which of the two is wrong — the uniqueness constraint or the abuse
signal that depends on collisions. That is a Section 07 product decision and is deliberately not
taken here.

---

## Not executed in this pass

Stated rather than assumed:

- **A11y / axe (Phase 28)** — needs the app servers plus a Playwright run; not performed. The new
  panel was built with labelled controls, `htmlFor`/`id` pairing, `aria-describedby` on unavailable
  channels, `role="alert"` on the error state and native checkboxes for keyboard operation, but that
  is construction, not verification.
- **Responsive sweep across 12 widths (Phase 29)** — not performed this pass.
- **Browser E2E (Phases 23, 25, 26)** — APIs and clients were verified by code path and typecheck,
  not by driving a browser.
- **Partner Mobile (Phase 24)** — **no mobile application exists in this repository.** `apps/`
  contains `admin-panel`, `backend`, `docs`, `partner-web`, `web`. The mobile-facing surface is the
  push-token registration endpoint and Expo delivery, both of which are exercised by the preference
  work above. Any prior claim of mobile verification was not verifiable here.

---

## Blockers to FULL PASS

1. A11y, responsive and browser E2E gates not executed (require running servers).
2. `surge-alert.integration` and `chaos-certification` require environments not available here.
3. Section 07 `BANK_REUSE` / unique-constraint contradiction is open and needs a product decision.
4. Partner Mobile cannot be certified — the application does not exist in this repository.
5. Per-product-category notification preferences (the nine categories) need a schema change and a
   policy decision. POLICY PENDING.

Items 1–2 are environmental. Items 3–5 need a human decision, not more code.

---

## Files changed

**Backend**
- `src/notifications/legacy-preference-bridge.ts` (new)
- `src/notifications/channel-availability.ts` (new)
- `src/automation/registry/legacy-path-guard.ts` (new)
- `src/notifications/recipient-resolver.ts`
- `src/notifications/channels/push.adapter.ts`
- `src/services/device-push.service.ts`
- `src/services/push-delivery.service.ts`
- `src/services/notification.service.ts`
- `src/services/admin-automation.service.ts`
- `src/routes/users.ts`
- `src/routes/notifications.ts`
- `src/events/consumers/automation-scheduler.consumer.ts`
- `src/events/jobs/review-request.job.ts`
- `src/automation/registry/definitions/index.ts`
- `src/__tests__/section09-closure.integration.test.ts` (new)
- `scripts/verify-preference-chain.ts` (new)

**Partner Web**
- `src/components/settings/NotificationPreferencePanel.tsx` (new)
- `src/components/settings/SettingsCenter.tsx`
- `src/services/partner-api.ts`

**Customer Web**
- `src/app/(with-bottom-nav)/(aurora-nav)/settings/page.tsx`

**Admin Panel**
- `src/app/(console)/automation/page.tsx`
- `src/services/admin-api.ts`
