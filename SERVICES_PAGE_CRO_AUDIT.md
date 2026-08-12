# HOMEEIGO — Services Page CRO Audit (Phase 1)

**Surface:** Customer mobile app services page (`homigo-mobile/src/screens/ServicesScreen.tsx`).
**Lens:** Conversion rate — every finding is judged by "does this move a visitor toward a completed booking?"
**Hard constraints honoured:** no backend change, no API change, no fabricated data, no hardcoded ratings/counts.

---

## 0. Current funnel shape

Section order today:

`Hero → Categories → Home Care → Premium Care → Laundry → Outdoor → Express → Coming Soon → Transparent Pricing → Reviews → Why Choose Us → Cities → How It Works → Premium Banner → AI → Final CTA → Footer`

16 sections. **The only booking entry points are inside cards, the hero, and the final CTA.** Everything between is browse-only.

---

## 1. Conversion blockers (ranked by impact)

### 🔴 CB-1 — No persistent booking CTA (highest impact)
Once the hero scrolls away there is **no always-available way to book**. A user convinced at section 6 must either scroll back up, tap a card, or scroll to the end. Every competitor named in the brief (Uber, Urban Company, Booking.com) keeps a persistent commit action on screen.
**Fix:** sticky bottom booking bar that appears after first scroll, above the tab bar, never covering content.

### 🔴 CB-2 — Aggregate social proof exists in the backend but is never shown
`GET /api/stats/overview` already returns `averageRating`, `reviewCount`, `completedBookings`, `activeProviders`, `customers`. **None of it is on the page.** The page shows individual reviews but never the trust-compounding aggregate ("4.9★ · 12,480 reviews · 50k jobs done").
**Fix:** a Social Proof strip bound to that live endpoint, each metric hiding independently when the backend returns null/0. No invented numbers.

### 🟠 CB-3 — Trust arrives ~10 sections too late
Hero has 4 trust pills (good), but the substantive trust content — Why Choose Us, Cities, How It Works — sits far below the fold. The brief's 10-second trust window is missed.
**Fix:** a Trust strip immediately after the hero.

### 🟠 CB-4 — Scroll fatigue from 5 near-identical rails
Home Care → Premium Care → Laundry → Outdoor → Coming Soon are five visually identical horizontal photo rails, back-to-back. This is high scroll cost with low decision value and it delays every trust/price/proof section.

### 🟠 CB-5 — "Coming Soon" sits mid-funnel
Unavailable services are shown *before* pricing, reviews and guarantees. This injects a dead-end ("I want that — oh, I can't have it") at the moment intent is forming.
**Fix:** move below the conversion-critical sections.

### 🟡 CB-6 — Pricing lacks decision information
Transparent Pricing shows name + "From ₹X" only. Missing: what's included, what's not, duration, add-ons, who it's for. Price without scope creates hesitation, not confidence.

### 🟡 CB-7 — Locality personalization unused
A coverage API exists (`/api/coverage/cities`, live partner counts per city) and the app knows the user's selected city, but the page never says "available in *your* city, N professionals nearby." This is a proven proximity/availability conversion lever.

---

## 2. Trust blockers

| Issue | Detail |
|---|---|
| No aggregate rating near top | Individual reviews only, deep in the page |
| No guarantee block | On-time / rework / damage-protection promises are absent as a dedicated unit |
| No insurance/verification specificity | Hero pills say "Background Verified" but nothing reinforces it later with substance |
| Reviews section vanishes when empty | `CustomerReviews` returns `null` on empty — a silent gap rather than a trust-preserving state |

## 3. Cognitive overload

- Hero occupies ~86% of viewport height — the first screen contains **no service and no price**, only a value proposition. Strong for brand, weak for intent capture.
- 16 sections with no visual "chapter" breaks; the user cannot tell how far they are or what's left.
- Five consecutive rails with identical treatment blur into one another (no differentiation cue).

## 4. Missing CTA / weak hierarchy

- Sections **Why Choose Us, Cities, How It Works** have *no CTA at all* — pure information, no next step.
- Reviews section ends with no "book what they booked" action.
- Category rails have per-card arrows but no section-level CTA.

## 5. Dead space / scroll fatigue

- Coming Soon rail consumes a full section for services that cannot be booked.
- Cities section is tall (metrics + 11 tiles) and sits between two other trust sections — reinforcing the same message three times consecutively.

## 6. Mobile friction

- No thumb-zone commit action (see CB-1) — all CTAs require reaching into the upper 2/3 of the screen.
- `CustomerReviews` loading state is a bare `ActivityIndicator`; `CategoriesSection` renders nothing while loading → perceived slowness and layout shift.
- Content bottom padding reserves only the tab bar; any new sticky bar must be accounted for or it will occlude the last card.

## 7. Loading & empty states

| Section | Loading | Empty |
|---|---|---|
| Reviews | `ActivityIndicator` (generic) | returns `null` (invisible) |
| Categories | nothing rendered | nothing rendered |
| Pricing | prices show "₹—" until catalog resolves | n/a |
| Cities | skeleton present ✅ | graceful message ✅ |

Cities is the reference implementation; the rest should match it.

---

## 8. Prioritized CRO action plan

| # | Action | Phase | Impact | Data source |
|---|---|---|---|---|
| 1 | **Sticky bottom booking bar** | 8 | 🔴 Highest | catalog (price) — hides price if absent |
| 2 | **Social proof strip (live)** | 4 | 🔴 High | `/api/stats/overview` — per-metric graceful hide |
| 3 | **Trust strip after hero** | 2 | 🟠 High | brand guarantees (no metrics invented) |
| 4 | **Skeleton loaders** | 10 | 🟠 Medium | — |
| 5 | **Empty states** | 9 | 🟡 Medium | — |
| 6 | Reorder: Coming Soon below conversion sections | 1 | 🟠 Medium | — |
| 7 | Pricing detail (included / duration / add-ons) | 6 | 🟡 Medium | **blocked** — catalog lacks these fields |
| 8 | Locality personalization | 7 | 🟡 Medium | `/api/coverage/cities` + selected city |

## 9. Explicitly NOT doing (and why)

- **Phase 3 — Before/After comparison slider.** This requires genuine before/after photography per service (kitchen, bathroom, sofa, mattress, carpet, window, vehicle). We have **no such assets**, and the brief forbids fake images. Building it with stock or duplicated images would be fabrication. **Deferred until real assets exist** — the section is specified, not shipped.
- **Hardcoded ratings / booking counts / review counts.** Only rendered from `/api/stats/overview`; each metric hides independently when the backend returns null or 0.
- **Pricing "included / not included / duration"** — the catalog API does not expose these fields. A component that renders them the moment the API does is the correct answer, not invented copy.

---

*Phase 1 complete. Implementation and verification are recorded in `SERVICES_PAGE_CRO_REPORT.md`, `SERVICES_PAGE_CONVERSION_CERTIFICATION.md` and `SERVICES_PAGE_ENTERPRISE_SCORE.md`.*
