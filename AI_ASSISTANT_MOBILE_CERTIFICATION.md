# HOMEEIGO — Mobile AI Assistant Certification

**Date:** 2026-07-29 · **Surface:** `homigo-mobile` AI Assistant (`(tabs)/ai`)
**Verdict:** ✅ **PASS — with on-device verification outstanding** (see §3).

Supersedes the 2026-07-23 certification, three of whose claims did not survive re-verification
(`AI_ASSISTANT_MOBILE_AUDIT.md` §1). Every row below is backed by a build result or a
repeatable scan.

---

## 1. Certification matrix

| Dimension | Status | Evidence |
|---|---|---|
| **No fabricated data** | ✅ | Booking card now renders only from `useActiveTracking()`; invented pro, ETA, route, distance and progress removed; recommendation notes no longer claim a per-user schedule |
| **No dead affordances** | ✅ | `onPress={() => {}}` scan returns 0 on the AI surface; former "Call expert" now opens `/track/[id]` |
| **Truthful affordances** | ✅ | Microphone iconography removed — no STT exists, so no control implies dictation |
| **Design system** | ✅ | One token source; 4/8 spacing grid; retained type + radius scales |
| **Brand consistency w/ website** | ✅ | Purple/violet hex scan returns **0** (2 leaks found and fixed this pass) |
| **Context awareness** | ✅ | Hero copy and conversation chips branch on live-booking state and time of day |
| **Accessibility — labels** | ✅ | Every interactive element on the surface is labelled; chat bubbles expose author + time + delivery |
| **Accessibility — live region** | ✅ | Thinking state announced politely |
| **Accessibility — decorative content** | ✅ | Route illustration hidden from assistive tech |
| **Motion** | ✅ | Directional spring message entry; existing streaming/ambient motion preserved |
| **Empty state** | ✅ | Chat seeded by `welcomeMessage(firstName)` — never blank |
| **Responsiveness** | ✅ | `useTrackingLayout` branches at 360/375/414; no fixed-width overflow path |
| **Type safety** | ✅ | `tsc --noEmit` exit 0 |
| **Build** | ✅ | `expo export --platform android` exit 0 (Hermes 9.05 MB) |
| **Business logic** | ✅ | Untouched |
| **API integrity** | ✅ | Untouched — chips send text to the existing endpoint |
| **Navigation** | ✅ | Untouched; the new "Track live" CTA uses the existing `/track/[id]` route |
| **On-device visual verification** | ⚠️ **Not done** | Phone left USB mid-session; new booking/empty states not screenshotted |
| **Runtime FPS profiling** | ⚠️ **Not done** | Ambient loop not re-profiled |

## 2. Data & safety attestation

- No value shown in the AI Assistant is invented. Where data is unavailable, the UI shows an
  em dash or omits the element entirely.
- No backend, API, AI-logic or routing file was modified.
- All existing AI features remain functional: chat, thinking/streaming, quick actions, booking
  block (now real-data-gated), live-tracking illustration, recommendations, composer.

## 3. Scope of this certification

This certifies the **code state**: types, build, and repeatable scans for fabricated data, dead
handlers, off-brand colour and accessibility coverage. It does **not** certify on-device
appearance of the new states, which requires the phone to be reconnected — the honest gap is
recorded here rather than assumed away.
