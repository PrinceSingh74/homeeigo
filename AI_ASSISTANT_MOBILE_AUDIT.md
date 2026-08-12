# HOMEEIGO — Mobile AI Assistant Audit

**Date:** 2026-07-29 · **Surface:** `homigo-mobile` `(tabs)/ai` vs `apps/web` `/ai`
**Scope:** UX/UI/motion/a11y only. No backend, API, AI-logic or navigation change.

This is the second audit pass. The first (2026-07-23) synced the design language to emerald
and wired dead controls. This pass re-verified those claims against the code and found that
**three of them did not hold**, plus a class of fabricated content the first pass missed.

---

## 1. Verification of the previous audit's claims

| Previous claim | Holds? | Evidence |
|---|---|---|
| "0 purple/cyan literals remain" | ❌ **No** | Two survived: `app/(tabs)/ai.tsx` composer-dock `shadowColor: "#7B61FF"`, and `AiHeroCard` orb gradient stop `#5B45E0`. Found by scanning every hex on the surface and flagging blue-dominant, red>green values — the earlier scan used a fixed keyword list and missed both. |
| "Eliminated all dead buttons — every affordance performs a real action" | ❌ **No** | `AiBookingBlock` "Call expert" was `onPress={() => {}}`. |
| "No fabricated data" | ❌ **No** | See §2 — the entire booking card and the recommendation notes were invented. |

## 2. Integrity findings (highest severity)

**2.1 — `AiBookingBlock` rendered a fabricated booking for every user.**
The component took no booking data at all. It rendered unconditionally, so a user with no
booking still saw a confirmed job in progress:

| Shown | Source |
|---|---|
| "Your Booking is Confirmed · Expert on route" | hardcoded heading |
| "Rahul Kumar · 4.9 · AC Repair Expert" | hardcoded string + DiceBear avatar `seed=rahul` |
| "Arriving in **12** mins" | hardcoded literal |
| "Sector 12 → Indiranagar · **2.4 km**" | hardcoded literals |
| Progress: Confirmed ✓ / On the way ✓ / Arriving | hardcoded array |
| "Call expert" | dead handler |

This contradicts the product's own standing rule that the backend is the source of truth and
unbacked surfaces must not show invented values.

**2.2 — "AI Recommendations for You · Personalized for your home"** was a static array of four
items whose notes ("Recommended next week", "Recommended in 7 days", "Due in 15 days",
"Recommended in 20 days") asserted a per-user schedule the app never computes.

**2.3 — Microphone iconography promised speech input that does not exist.**
The hero orb, hero CTA ("Talk to AI") and composer FAB all showed a `Mic` and all three only
focused the text input. The app ships no speech-to-text (`expo-av` is present; no STT), and
the **website AI has no voice feature either** — so a voice UI would also have diverged from
the design language it is supposed to match.

## 3. Accessibility findings

| Component | Interactive | Labelled (before) |
|---|---:|---:|
| `AiBookingBlock` | 6 | **0** |
| `SectionTitle` ("View all") | 3 | **0** |
| Chat bubbles | — | **0** — no author, time or delivery state exposed |
| Thinking indicator | — | **0** — silent for screen readers |

## 4. Design-language comparison with the website

| Dimension | Website `/ai` | Mobile (before) | Verdict |
|---|---|---|---|
| Palette | emerald/teal | emerald/teal + 2 purple leaks | ⚠️ fixed this pass |
| Greeting | time-aware | time-aware | ✅ |
| Hero headline | contextual | **static** single line | ⚠️ fixed this pass |
| Conversation chips | — | **static** 3-item toolbar | ⚠️ made contextual |
| Voice | none | mic icons (non-functional) | ⚠️ made honest |
| Empty state | seeded greeting | seeded greeting (`welcomeMessage`) | ✅ already correct |
| Message motion | fade | fade | ⚠️ now directional spring |

## 5. Responsive / performance

- `useTrackingLayout` already branches at 360 / 375 / 414; map width is clamped to content.
- Remaining fixed pixel widths are decorative glows and horizontal-scroll cards — no overflow path.
- Changes in this pass are declarative (entering animations, conditional render); the fabricated
  booking card is now **absent** for users without a booking, which removes an always-on
  animated SVG route from the tree for those users — a net reduction in work.

## 6. What was NOT changed, and why

- **No voice recorder / waveform / "listening" state.** Building one would require STT the app
  does not have and the backend may not add; a listening UI that does not listen is a fabricated
  capability. Documented rather than faked.
- **No price/duration/availability on service cards.** The catalog API does not expose those
  fields. Inventing them was the exact failure mode found in §2.
