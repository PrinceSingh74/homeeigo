# HOMIGO Design System

**Style:** Luxury Aurora AI · **App:** `apps/web` (customer web)

## Table of Contents

- [Colors](#colors)
- [Typography](#typography)
- [Spacing](#spacing)
- [Components](#components)
- [Animations](#animations)
- [Responsive Design](#responsive-design)
- [Accessibility](#accessibility)
- [Dark Mode](#dark-mode)
- [Storybook](#storybook)

## Colors

### Brand

| Token | Hex |
|-------|-----|
| Primary Blue | `#2563EB` |
| Violet | `#7C3AED` |
| Cyan | `#06B6D4` |
| Pink | `#EC4899` |
| Gold | `#D4AF37` |

### Semantic

| Token | Usage |
|-------|--------|
| `success` | Confirmations |
| `warning` | Pending / caution |
| `error` | Errors, destructive |
| `info` | Neutral information |

### Theme-aware (CSS variables)

`--bg`, `--surface`, `--content`, `--muted`, `--line` — mapped to Tailwind utilities `bg-canvas`, `bg-surface`, `text-content`, `text-muted`, `border-line`.

Defined in `apps/web/src/app/globals.css`.

## Typography

| Role | Font |
|------|------|
| Display / headings | Sora (`--font-display`) |
| Body | Inter (`--font-sans`) |
| Mono | JetBrains Mono (`--font-mono`) |

Fluid section titles: `src/lib/page-layout.ts` (`sectionTitle`, `pageTitle`).

## Spacing

4px base unit (`--homigo-space-*` on `:root` — **not** in `@theme`):

| Token | Value |
|-------|-------|
| `--homigo-space-2xs` | 4px |
| `--homigo-space-xs` | 8px |
| `--homigo-space-sm` | 12px |
| `--homigo-space-md` | 16px |
| `--homigo-space-lg` | 24px |
| `--homigo-space-xl` | 32px |
| `--homigo-space-2xl` | 48px |
| `--homigo-space-3xl` | 64px |
| `--homigo-space-4xl` | 80px |

Use these in custom CSS only. Do not define `--spacing-sm` / `--spacing-xl` in `@theme` — Tailwind v4 maps those names to `max-w-sm`, `max-w-xl`, and breaks layout sitewide.

Page layout helpers: `pageSection`, `pageSectionGap`, `pagePadX` in `@/lib/page-layout`.

## Components

Import from `@/components/ui`:

```tsx
import { Input, Textarea, Select, Checkbox, Radio, RadioGroup, Button, Card } from "@/components/ui";
```

### Input

Variants: `default` | `search` | `error` | `success` | `disabled`  
Sizes: `sm` | `md` | `lg` | `xl`

```tsx
<Input label="Email" type="email" placeholder="user@example.com" isRequired />
<Input variant="search" placeholder="Search services…" />
```

### Textarea

```tsx
<Textarea label="Review" showCharacterCount maxCharacters={500} autoResize />
```

### Select

Custom dropdown with keyboard navigation, optional search and multi-select.

```tsx
<Select label="Service" options={options} isSearchable placeholder="Select…" />
```

### Checkbox / Radio

```tsx
<Checkbox label="I agree to terms" helperText="Required to continue" />
<RadioGroup name="payment" options={paymentOptions} value={value} onChange={setValue} />
```

### Button

Variants: `primary` | `secondary` | `outline` | `ghost` | `danger` | `success` (+ legacy `glass`, `gold`, `dark`)

### Card

Variants: `default` | `bordered` | `elevated` | `interactive` | `glass` | `gradient`

## Animations

Central library: `src/lib/animations.ts`

- Fade: `fadeIn`, `fadeUp`, `fadeDown`, `fadeLeft`, `fadeRight`
- Scale: `scaleIn`, `scaleUp`
- Slide: `slideInLeft`, `slideInRight`
- UI: `modalContent`, `toastEnter`, `menuVariants`, `dropdownVariants`
- Interaction: `buttonHover`, `buttonTap`, `inputFocus`, `cardHover`, `shake`

```tsx
import { motion } from "framer-motion";
import { fadeUp, containerVariants, listItem } from "@/lib/animations";

<motion.div variants={fadeUp} initial="hidden" animate="visible">…</motion.div>
```

AI pages may still import legacy keys from `@/components/ai/ai-motion` (`show` variant names).

## Responsive Design

Breakpoints: Tailwind defaults + custom `--breakpoint-xs: 380px`.

- Mobile-first utility classes
- Safe area: `env(safe-area-inset-*)` in `pagePadX` and bottom nav
- Minimum touch target: 44×44px on form controls

## Accessibility

- Labels + `aria-invalid` / `aria-describedby` on form fields
- Visible `focus-visible` rings
- `prefers-reduced-motion` respected in `globals.css` and components
- Keyboard: Select (arrows, Enter, Escape), native radio/checkbox semantics

## Dark Mode

Toggle via `<html class="dark">` + `ThemeToggle`. No extra props on UI components.

## Storybook

```bash
cd apps/web
npm run storybook
```

Open http://localhost:6006 — stories under `src/components/ui/*.stories.tsx`.

## Best Practices

1. Reuse `@/components/ui` primitives before custom markup
2. Use spacing tokens and `page-layout` helpers
3. Import animations from `@/lib/animations`
4. Test light + dark in Storybook toolbar
5. Keep homepage/booking mock data in `@/lib/services` until APIs are wired
