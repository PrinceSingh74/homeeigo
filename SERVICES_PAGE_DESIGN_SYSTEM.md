# HOMEEIGO — Services Page Design System

**Surface:** Customer mobile app (React Native / Expo) — services page and its section components.
**Source of truth:** `homigo-mobile/src/theme/tokens.ts` (spacing, radius, control heights), `theme/layout.ts` (rhythm + named radii), `theme/typography.ts` (type ramp), `theme/services-theme.ts` (colour), `lib/services-layout.ts` (responsive maths).

> The reference brief targets a web layout (12-column grid, 64–72px hero, hover). This is a mobile app: the **principles** (8px rhythm, one type ramp, one card system, one button system, generous whitespace, subtle motion, AA contrast) are applied; the **pixel targets** are adapted to a 390pt canvas. "Hover" → press/active states. "Grid" → the responsive column maths in `services-layout.ts`.

---

## 1. Spacing — 4/8 scale

Defined in `tokens.ts`. Nothing outside this ramp.

| Token | Value | Typical use |
|---|---|---|
| `xs` | 4 | icon↔label hairline gaps |
| `sm` | 8 | chip padding, tight gaps |
| `md` | 12 | badge padding, small gaps |
| `lg` | 16 | **default card padding**, list gaps |
| `xl` | 20 | roomy card padding |
| `2xl` | 24 | feature-card padding |
| `3xl` | 32 | block separation |
| `4xl` | 40 | **section gap (base)** |
| `5xl` | 48 | large section break |
| `6xl` / `7xl` | 64 / 80 | hero-scale breathing |

**Vertical rhythm** (`layout.ts` + responsive clamp in `services-layout.ts`):
- `sectionGap` **40** (clamped 30–46 across device widths)
- `sectionGapTight` **30** (clamped 22–34)
- `headerToContent` **18**
- `listGap` **16**

**Horizontal rhythm:** screen padding is responsive — `14` (compact <360) / `16` (small <375) / `20` (default). Every rail and header reads the same `L.pad`, so headers and card rails align on all devices.

## 2. Radius — one 5-step scale + pill

| Token | Value | Role |
|---|---|---|
| `radius.xs` | 8 | badges, tiny chips |
| `radius.sm` | 12 | compact controls, small cards |
| `radius.md` | 16 | standard cards, icon tiles |
| `radius.lg` | 20 | feature cards, media cards |
| `radius.xl` | 24 | hero cards, bottom sheets |
| `radius.pill` | 999 | chips, pills, dots |

`layout.ts` maps its named radii onto the scale, so existing call-sites inherit it:
`cardRadiusSm → sm(12)`, `cardRadius → lg(20)`, `cardRadiusLg → xl(24)`, `cardRadiusXl → xl(24)`, `iconRadius → md(16)`, `chipRadius → pill`.

**Allowed exception:** true circles use `radius = size / 2` (avatars 46→23, bell/avatar ring 36→18, icon discs 50→25, sparkle 26→13). These are geometrically correct, not off-scale.

## 3. Typography ramp

Poppins, four weights (`400 / 500 / 600 / 700`), defined in `typography.ts`.

| Role | Size / Line | Tracking | Use |
|---|---|---|---|
| `display` | 26 / 32 | −0.6 | statement numbers |
| `heroTitle` | 30 / 36 | −0.8 | hero H1 (hero overrides to 30–34 responsively) |
| `sectionTitle` | **21 / 27** | −0.5 | every section H2 |
| `sectionSubtitle` | 13 / 19 | 0 | section supporting line |
| `cardTitle` | 14 / 20 | −0.2 | card headings |
| `cardTitleSm` | 13 / 18 | −0.15 | dense card headings |
| `body` | 13 / 20 | 0 | paragraph copy |
| `caption` | 11 / 16 | 0 | metadata |
| `overline` | 10 / 14 | +1.2, uppercase | section kicker |
| `button` / `buttonSm` | 14 / 12 | +0.25 / +0.2 | CTA labels |

**Hierarchy rule:** every section reads *kicker → title → subtitle → content*. The shared `SectionHeader` enforces it, including a gradient "kicker bar" so the rhythm repeats identically across all ~11 sections.

## 4. Section header (the page's editorial anchor)

`components/services/common/SectionHeader.tsx` — one component, used by every section:
- gradient kicker bar (emerald→teal, 18×3, radius 2) + uppercase overline
- `sectionTitle` (21/27, −0.5)
- optional subtitle (max-width 94% so lines never run edge-to-edge)
- optional "View all" as a **pill with arrow** (bordered, `radius.pill`), not raw text

## 5. Cards

One recipe, three sizes:

| Class | Radius | Padding | Shadow | Example |
|---|---|---|---|---|
| Compact | `sm/md` (12–16) | 16 | none / soft | pricing cards, city tiles |
| Standard | `lg` (20) | 16–20 | `soft` | AI cards, review cards, timeline cards |
| Feature / media | `xl` (24) | 20–24 | `medium`/`deep` | category rails, express, premium banner |

Rules: equal padding per class, one radius per class, image cards use a consistent bottom scrim + title + price-pill + arrow, and press feedback is always `PressableScale` (spring, no colour flash).

## 6. Buttons

Canonical component: `common/BookNowButton.tsx` (`filled` | `outline`, scaled heights 38 / 34-compact, radius `sm`, one text style, haptic on press).

Control-height scale in `tokens.ts` for new work: `control.sm 40 / md 48 / lg 56`.

**Fixed this pass:** the two hero CTAs had **different vertical padding (15 vs 14) → unequal heights**. Both are now `paddingVertical: 16`, `radius: 16` — equal-height, on-scale.

*Known remaining debt:* `PremiumBanner` and `CTABanner` still use bespoke CTA styling (documented in the audit as P1). They are on-scale now but not routed through `BookNowButton`.

## 7. Colour

Emerald/mint luxury palette from `services-theme.ts` — light + dark themes, token-driven (`primary`, `accentPurple`(teal), `textPrimary/Secondary/Muted`, `card`, `cardBorder`, `borderLight`, `success`, `gold`, orbs, ambient mesh).

Rules: no ad-hoc hex in sections; gold is **semantic only** (ratings, premium); slate = coming-soon. Purple was fully purged from the services page (light **and** dark) in an earlier pass.

## 8. Motion

Reanimated only, UI-thread. Vocabulary: `FadeIn / FadeInUp / FadeInRight / SlideInRight`, stagger `45–90ms × index`, spring press-scale `0.94–0.98`. Scroll-driven work uses shared values (no re-render).

The navbar is the reference micro-interaction: a **continuous, scroll-driven two-layer cross-fade** (white-over-image ↔ frosted-light) plus a depth shadow that grows with scroll — no colour "pop", 60fps, zero re-renders.

## 9. Accessibility

- Interactive icon-only controls carry `accessibilityRole="button"` + a descriptive `accessibilityLabel` (navbar location / notifications / profile done this pass; notifications label announces unread count).
- The navbar's decorative cross-fade layer is `accessibilityElementsHidden` + `importantForAccessibility="no-hide-descendants"` so screen readers never read the bar twice.
- Contrast: emerald `#059669` on white ≈ 4.5:1 (AA). `textMuted #9CA3AF` is reserved for ≥14px; small text uses `textSecondary #6B7280`.
- Tap targets: chips/bell/avatar ≥ 36pt; `hitSlop` used on small links.

## 10. Responsiveness

`services-layout.ts` computes every width from the live viewport with clamps — `pad`, `contentW`, `listGap`, card widths (trending/ai/review/why/category), hero type sizes, section gaps. Breakpoints: **compact <360**, **small <375**, **default**, **large ≥414**. This is the mobile equivalent of the 12/8/4-column requirement: one set of maths, no hard-coded widths, no overflow.

---

## 11. Rules of engagement

1. Never write a raw spacing/radius literal — import from `tokens.ts` (or `layout.ts`).
2. Circles are the only radius exception (`size / 2`).
3. Every section starts with `SectionHeader`.
4. New CTAs go through `BookNowButton`.
5. Colour comes from the theme, never inline hex.
6. Any data-backed badge (rating, duration, booking count) renders **only** when the API supplies it — never mocked.
