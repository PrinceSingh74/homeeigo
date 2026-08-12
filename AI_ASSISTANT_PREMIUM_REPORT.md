# HOMEEIGO — Mobile AI Assistant Premium Report

**Date:** 2026-07-29 · **Companions:** `AI_ASSISTANT_MOBILE_AUDIT.md`, `AI_ASSISTANT_MOBILE_CERTIFICATION.md`, `AI_ASSISTANT_2050_SCORE.md`
**Constraint honoured:** no backend, API, AI-logic or navigation change. All existing features preserved.

---

## 1. What changed

### 1.1 Truthfulness (the largest change)

The AI screen previously presented a complete, invented booking to every user. It now presents
only what exists.

| Before | After |
|---|---|
| Booking card always rendered | Rendered **only** when `useActiveTracking()` returns a live booking; otherwise absent |
| "Rahul Kumar · 4.9 · AC Repair Expert" + stock avatar | `activeBooking.proName` + initials monogram (we know the name, not the face) |
| "Arriving in 12 mins" | `tracking.eta` when the live feed has it, `—` when it does not |
| "Sector 12 → Indiranagar · 2.4 km" | Removed — no such data exists client-side |
| Progress hardcoded to step 2 | Derived from `activeBooking.status` |
| "Call expert" (dead) | "Track live" → real `/track/[id]` screen |
| "AI Recommendations for You · Personalized for your home", "Due in 15 days" | "Popular home services · Tap to explore and book", category descriptors |

The stylised route illustration is retained as decoration but is now hidden from assistive tech
so it is never announced as positional data.

### 1.2 Context awareness (Phases 3 & 8)

- **Hero** copy branches on real state: a live booking gives "Your pro is on the way / Track them
  live, or ask me anything about this booking"; otherwise the headline and subline follow the
  time of day. Greeting and first name were already contextual and are unchanged.
- **Conversation chips** are no longer a fixed toolbar. With a job in flight they become
  *Track my pro · Reschedule · Need help*; otherwise *Diagnose Now · Book Expert · Get Estimate*.
  Each chip sends ordinary text to the existing AI endpoint — no new API, no new logic.

### 1.3 Motion (Phase 10)

Messages now enter from the side they belong to (`FadeInRight` for the user, `FadeInLeft` for the
assistant, spring-damped 20) instead of a uniform fade, so the thread reads as a conversation
rather than a list refresh. Existing streaming, thinking-dot, ambient and press-scale motion is
unchanged.

### 1.4 Accessibility (Phase 15)

- Each chat bubble is a single accessible node: *"You said: … Sent 10:42, delivered."* /
  *"Homeeigo AI said: … 10:42."* Timestamp and tick are hidden as separate nodes so they are not
  read as stray items.
- The thinking indicator is an `accessibilityLiveRegion="polite"` announcing "Homeeigo AI is
  thinking", so a screen-reader user hears that a reply is coming instead of silence.
- "View all" buttons now name their section (three identical buttons were previously
  indistinguishable).
- Booking card and its CTA are labelled with the real service and pro name.

### 1.5 Brand consistency

Both surviving purple literals removed: composer-dock shadow `#7B61FF → #10b981`, hero orb
gradient `#5B45E0 → #2dd4bf`. A hex-space scan (blue-dominant, red>green) now returns zero hits
on the AI surface.

## 2. Deliberately not built

**Voice capture / waveform / listening state.** The app has no speech-to-text, the backend
cannot be changed under this mandate, and the website AI — the design language being matched —
has no voice feature at all. A "listening" animation that does not listen is a fabricated
capability, which is the same defect this pass spent most of its effort removing. Instead the
misleading microphone iconography was replaced with icons that match what the controls do
(open the composer), and the controls gained `accessibilityHint="Opens the message box"`.

**Price / duration / availability on AI service cards.** The catalog API does not expose these
fields. Adding them would mean inventing them.

## 3. Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | **0 errors** |
| `expo export --platform android` | **exit 0**, Hermes bundle 9.05 MB |
| Dead-handler scan (`onPress={() => {}}`) | **0** on the AI surface |
| Purple/violet hex scan | **0** on the AI surface |
| Fabricated-literal review | booking card, ETA, route, recommendation notes all removed |

Not verified in this pass: on-device screenshots of the new states (the phone disconnected from
USB mid-session), and FPS profiling of the ambient loop.
