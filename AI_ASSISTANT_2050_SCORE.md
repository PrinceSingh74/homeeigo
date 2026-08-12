# HOMEEIGO — Mobile AI Assistant · 2050 Score

**Date:** 2026-07-29 · **Surface:** mobile AI Assistant
**Stance:** honest scoring. Points are withheld where work remains, and the previous pass's
score is corrected downward where its claims did not survive re-verification.

---

## Correction to the previous score

The 2026-07-23 scorecard recorded **Functional integrity 96/100** ("eliminated all dead buttons")
and **91/100 overall**, and its certification asserted "No fabricated data ✅". Re-verification
found a dead handler, two off-brand colour literals, and an entire fabricated booking card
rendered to every user. The honest retrospective value of that pass on *functional integrity*
was closer to **60/100**. That is corrected here rather than quietly overwritten.

## Scorecard

| Dimension | Score | Basis |
|---|---:|---|
| **Data integrity / truthfulness** | **97 / 100** | Fabricated pro, ETA, route, distance, progress and per-user recommendation timing all removed; booking card gated on real state; unknown ETA renders `—`. −3: the route illustration is still decorative art inside a card about a real journey. |
| **Functional integrity** | **97 / 100** | 0 dead handlers; former dead CTA now opens the real tracking screen; every control does what its label says. −3: composer "attach" still only focuses the input (honestly labelled, but not a real attachment). |
| **Brand / design-language consistency** | **97 / 100** | Purple/violet hex scan returns 0 across the surface; emerald/teal matches the website AI. −3: gradient stops not pixel-matched to the web hero ramp. |
| **Accessibility** | **94 / 100** | Every interactive element labelled; chat bubbles expose author/time/delivery as single nodes; thinking state is a polite live region; decorative art hidden. −6: focus order and TalkBack traversal not verified on a real device this pass. |
| **Context awareness** | **90 / 100** | Hero copy and conversation chips both branch on live-booking state and time of day, from data already held. −10: no cross-session memory, no follow-up suggestions derived from the last reply. |
| **Motion / micro-interactions** | **86 / 100** | Directional spring message entry; press-scale + haptics throughout; streaming and ambient motion preserved. −14: no card-expand transition, no post-booking confetti. |
| **Premium visual feel** | **93 / 100** | Glass, ambient orbs, floating composer, layered shadows, branded photography. −7: the booking card lost some visual density when the invented rows were removed and could be re-composed around real fields. |
| **Design-system discipline** | **93 / 100** | One token source, 4/8 grid, retained scales; orphaned styles removed with the fabricated markup. −7: `aiRadius` remains AI-specific rather than the app-wide `radius` scale. |
| **Typography** | **92 / 100** | Display→micro ramp intact. −8: not re-measured against the website's exact web type sizes. |
| **Dark / light mode** | **94 / 100** | Both themes emerald-consistent. −6: dark canvas could use one more elevation step. |
| **Futuristic ("2050") experience** | **82 / 100** | Ambient gradients, glass, streaming chat, context-aware hero and chips. −18: predictive recommendations and AI memory need data the backend does not expose; voice needs STT the app does not ship. |
| **Performance** | **88 / 100** | Changes are declarative; users without a booking no longer mount an always-animating SVG route. −12: FPS not re-profiled on device. |
| **Business logic / API integrity** | **100 / 100** | Zero backend/API/logic/navigation change; verified by diff. |
| **Overall** | **93 / 100** | Honest, verifiable, and materially more trustworthy than the previous pass — which is the dimension that matters most for an assistant. |

## Why truthfulness is scored highest

An assistant's entire value is that the user believes what it says. A screen that told every user
a professional named Rahul Kumar was 12 minutes away — including users with no booking at all —
does more damage to that trust than any amount of polish repairs. Removing it was worth more
than any animation this pass could have added.

## Highest-value remaining work (ranked, honest about blockers)

1. **On-device verification** of the new booking / no-booking states — needs the phone on USB. *No blocker beyond that.*
2. **Card-expand + post-booking confetti** (Phase 10) — pure UI, no data needed.
3. **Follow-up suggestion chips derived from the last AI reply** — UI-only, uses text already in state.
4. **Focus-order / TalkBack traversal audit** — needs a device.
5. **Service cards with price, duration, availability** — **blocked**: the catalog API does not expose these fields. Must not be invented.
6. **Voice experience** — **blocked**: no STT in the app, backend changes out of scope, and the website AI has no voice either, so building one would diverge from the design language rather than match it.

## Integrity note

The "no fake data" rule was applied to the existing screen as strictly as to new work. Most of
this pass was spent deleting invented content rather than adding features, and the score reflects
that as progress.
