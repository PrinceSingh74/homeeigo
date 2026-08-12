# HOMEEIGO — Services Page UI/UX Audit

**Scope:** Customer mobile app services page — `homigo-mobile/src/screens/ServicesScreen.tsx` and its section components.
**Method:** Static inspection of every section + a data-driven scan of radius / padding / shadow / typography usage.
**Constraint:** Audit only — no business logic, API, backend or routing touched. Findings below drive the design-system pass documented in `SERVICES_PAGE_DESIGN_SYSTEM.md`.

> Note on the brief: the reference spec targets a **web** layout (12-col grid, 64–72px hero, hover states, FAQ). This surface is a **React Native / Expo mobile app**. The principles (8px rhythm, type hierarchy, one card system, breathing space, subtle motion, AA contrast) are applied; the pixel targets are adapted to a 390pt mobile canvas. "Hover" maps to press/active states; "grid" maps to the responsive column math in `services-layout.ts`.

---

## 0. Executive summary

The page already has a **strong foundation**: a responsive layout engine (`services-layout.ts`), a Poppins type scale (`typography.ts`), an emerald design language (`services-theme.ts`), an animated ambient canvas, a premium sticky immersive navbar, and one icon family (lucide). Recent passes fixed section rhythm, the shared `SectionHeader`, brand casing, and emerald consistency.

The **single biggest gap is token discipline**: corner radii, card paddings and button heights are set with ad-hoc literals per component instead of a shared scale. This is what separates "nicely styled" from "mathematically intentional / billion-dollar."

| Category | State | Priority |
|---|---|---|
| Radius scale | ❌ 24 distinct values, no scale | **P0** |
| Spacing scale | ⚠️ Section rhythm good; intra-card paddings ad-hoc (15/16/18/22) | **P0** |
| Button system | ⚠️ `BookNowButton` exists but CTA/Premium/Hero use bespoke buttons | **P1** |
| Typography hierarchy | ⚠️ Good scale; body 13 is tight; no single documented ramp | **P1** |
| Card system | ⚠️ Premium look, but radius/padding/shadow vary card-to-card | **P1** |
| Icons | ✅ One family (lucide), consistent stroke | — |
| Motion | ✅ Reanimated fade/slide/stagger, subtle | — |
| Accessibility | ⚠️ Pressables lack `accessibilityRole`/`Label`; some muted text borderline | **P1** |
| Contrast | ✅ Mostly AA (emerald/white); a few `#9CA3AF` on white are borderline | **P2** |

---

## 1. Global findings (data-driven)

**Border radius — 24 distinct literals found:** `2,3,4,5,6,8,10,11,12,13,14,15,16,17,18,20,22,23,25,50,70,80,100,999`.
Even accounting for pills (999) and circles, the card/chip/badge range (8–25) has no rhythm. Cards land on 16, 18, 20, 22 in different sections; badges on 8, 10, 13.

**Padding literals:** `8, 15, 16, 18, 22` — three of these (15, 18, 22) are off any 4/8 grid.

**Shadows:** five named tokens (`soft, glass, medium, deep, float`) — a good set, but applied inconsistently (some premium cards have no shadow, some flat chips do).

**Recommendation:** one radius scale + one spacing scale + one card recipe + one button recipe, all documented, all referenced by token — never by literal.

---

## 2. Section-by-section

### Navbar (`ServicesHeader`) — ✅ Strong
Immersive, sticky, frosted-on-scroll with a smooth two-layer content cross-fade; single icon family; brand-correct "Homeeigo". **No change needed.** Minor: add `accessibilityLabel`s to the icon buttons.

### Hero (`ServicesHeroSection`) — ✅ Strong
Full-bleed image, dual cinematic scrims, clear H1 with accent, two CTAs, four trust pills. Type hierarchy reads well. Minor: CTA buttons are bespoke (see Button system); trust pills padding is ad-hoc.

### Categories (`CategoriesSection`) — ⚠️ Good, minor polish
Horizontal chip rail with 3D icon, active/selection state wired to context (good). `name` 12px / `count` 10px are on the small side. Card vertical padding `4/8` is off-grid. Loading state = none (renders empty). **Fix:** align paddings, add a skeleton, bump label to 13.

### Category rails (`CategoryRail` ×5: Home Care / Premium / Laundry / Outdoor / Coming Soon) — ⚠️ Radius outlier
Beautiful branded photo cards with scrim, price pill, arrow. **Card radius `22`** is the outlier vs the rest of the page. Padding/gap consistent. **Fix:** normalize radius to the card scale.

### Express (`ExpressServices`) — ✅ Recently fixed
Horizontal rail, branded photos, "20 MIN" badge, real live-tracking preview. Card radius `18`. Consistent. Keep.

### Coming Soon (`CategoryRail soon`) — ✅ Consistent with rails.

### Transparent Pricing (`TransparentPricing`) — ⚠️ Radius/label
Two-column price cards (`47%` width, radius `16`) + trust strip. Card radius `16` differs from rails (`22`) and reviews (`20`). **Fix:** normalize radius; ensure equal heights (currently `flexGrow` — heights can differ if names wrap).

### Reviews (`CustomerReviews`) — ⚠️ Off-scale radius/padding
Premium snap-carousel, avatar + stars + verified badge + animated dots (active state good). Card radius `cardRadius+2 = 20`, inner padding `18`. **Fix:** move radius/padding onto the scale. Content model is strong (name, location, rating, review, verified) — matches the brief.

### Why Choose Us (`WhyChooseUs`) — ⚠️ Density
Horizontal `Premium3DCard` rail, emoji-in-tile + title + desc. Works, but the brief asks for premium *feature blocks*; horizontal scroll hides items. Consider a 2-col static grid for scannability. Icons are emoji, not lucide — inconsistent with the rest of the page's line-icon language.

### Cities (`CitiesSection`) — ✅ Recently rebuilt
Full-bleed dark band, live metrics, photo tiles with live partner counts (real API). Tile radius `16`. Strong. Keep.

### How It Works (`HowItWorks`) — ⚠️ Radius mix
Vertical timeline, gradient icon nodes (44), connectors. Icon radius `15`, card radius `18`. **Fix:** unify node/card radius; the timeline itself is premium.

### Premium Banner (`PremiumBanner`) — ✅ (purple removed last pass)
Emerald gradient, animated crown, feature rail, upgrade CTA. Radius `22`, padding `22`. Bespoke CTA button. **Fix:** radius to scale; CTA to button system.

### AI Recommendations (`AIRecommendations`) — ✅ Good
Gradient cards, emoji tile, seasonal badge, uses shared `BookNowButton` (good — this is the model other sections should follow). Radius `18`, padding `16` (on-grid). Keep; add `accessibilityLabel`.

### Final CTA (`CTABanner`) — ✅ Strong
Full-bleed emerald gradient, decorative orbs, shimmer button, clear offer. Bespoke button (radius `14`). **Fix:** button system.

### Footer (`HomeFooter`) — ✅ Recently fixed
Brand wordmark (fixed spelling), trust row, legal links, sign-off. Minimal-premium. Keep.

---

## 3. Buttons (cross-cutting) — P1
- `BookNowButton` (filled/outline, height 38/34, radius 14) is the closest thing to a system and should be the canonical primary/secondary.
- **Hero, PremiumBanner, CTABanner each roll their own button** (different heights, radii, paddings). This is the clearest "not one system" smell.
- No documented ghost/outline/disabled/loading states in one place.
- **Action:** document the button recipe (heights on the 8px scale: 40/48/56; radius from scale; one text style) and route bespoke CTAs through it where safe.

## 4. Typography — P1
- Scale is Poppins, reasonable, recently improved (section title 21/27). But **body is 13px** — tight for reading dense copy; the brief wants 16–18 (adapt to 15 on mobile).
- No single documented ramp (display → h1 → h2 → title → body → label → meta). **Action:** document the ramp with line-height + tracking; nudge body/caption up one step where it improves readability.

## 5. Accessibility — P1
- Many `Pressable`/`PressableScale` lack `accessibilityRole="button"` + `accessibilityLabel` (icon-only bell, location, arrows, dots).
- Decorative dots/stars should be `accessibilityElementsHidden` or labelled.
- Muted text `#9CA3AF` on white ≈ 2.5:1 — **below AA** for the smallest captions. Nudge to `#6B7280` (textSecondary) for anything ≤ 13px.
- **Action:** add roles/labels to interactive icons; reserve `textMuted` for ≥14px, use `textSecondary` for small.

## 6. Motion / Performance — ✅ mostly
Reanimated fade/slide/stagger, 60fps-friendly, no layout thrash. Horizontal rails virtualize where `FlatList` is used (CategoryRail) but `ScrollView` elsewhere (fine for small counts). Network images (cities, reviews) — add width/height to avoid CLS. Keep.

---

## 7. What must NOT be faked
The brief asks Popular-Service cards to show *duration, rating, booking count, AI badge*. Per the project's standing rule (backend = source of truth, never fabricate data), these are only added where the catalog/booking API actually provides them. Where the field doesn't exist yet, it is **omitted**, not mocked. This is called out so the redesign is not scored down for "missing" data that would otherwise be fake.

---

## 8. Prioritized action list
1. **P0 — Radius scale**: replace 24 literals with a 5-step scale (`sm 12 / md 16 / lg 20 / xl 24 / pill 999`).
2. **P0 — Spacing scale**: formalize the 8px scale as tokens; align off-grid paddings (15/18/22 → 16/16/24).
3. **P1 — Card recipe**: one radius (lg), one padding (16/20), one shadow per elevation.
4. **P1 — Button recipe**: heights 40/48/56, one radius, documented variants.
5. **P1 — Typography ramp**: documented, body/caption nudged for readability.
6. **P1 — A11y**: roles/labels on interactive icons; small-text colour → `textSecondary`.

Delivery of 1–6 is tracked in `SERVICES_PAGE_DESIGN_SYSTEM.md`; verification in `SERVICES_PAGE_PREMIUM_CERTIFICATION.md`.
