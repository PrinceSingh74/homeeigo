# HOMEEIGO Mobile — Performance Report

**Date:** 2026-07-29 · **App:** `homigo-mobile` (React Native 0.81 / Expo SDK 54)
**Scope:** rendering, animation, virtualisation, bundle. No backend, API, database, routing or
business-logic change.

> **Stack note:** the brief that prompted this work described a Flutter app (`flutter analyze`,
> `const` widgets, `RepaintBoundary`, Riverpod, Slivers, `AutomaticKeepAlive`). This project is
> React Native + Expo, so none of those apply. Everything below uses the stack that actually
> exists here: Reanimated 4, react-native-screens 4.16, FlatList, TanStack Query, Zustand.

> **No invented scores.** Every number is either read from the app's own startup telemetry, from
> `adb`, from the Metro/Expo build output, or from a repeatable file scan. Where a change could
> not be measured, that is stated rather than estimated.

---

## 1. Findings (measured)

### 1.1 Off-screen screens kept rendering — **the largest finding**

| Evidence | Value |
|---|---|
| `withRepeat(…, -1)` infinite animation loops in the codebase | **46** |
| `useFocusEffect` usages | **0** |
| `useIsFocused` usages | **0** |
| `cancelAnimation` usages | **1** |
| `enableFreeze` / `freezeOnBlur` before this pass | **absent** |

Expo Router keeps a visited tab mounted. With no freezing and no focus-awareness, every hero
pulse, particle field and shimmer across all six tabs kept driving the UI thread — and every one
of those trees kept re-rendering on any query update — while the user looked at a single tab.
Heaviest offenders by loop count: `WalletHeroCard` (4), then `Hero3DVisual`, `PremiumBanner`,
`AiHeroCard`, `PremiumSection`, `HeroSection`, `FinalCtaSection` (3 each).

### 1.2 Two long lists were not virtualised

| Screen | Before | Evidence |
|---|---|---|
| `(tabs)/bookings` | `filtered.map()` inside a `ScrollView` | every booking card mounted at once; each decodes a photo, paints a gradient and three shadows |
| `providers/index` | `rows.map()` inside a `ScrollView` | every search result mounted at once; each loads a remote avatar |

App-wide ratio at audit time: **40 files using `ScrollView` vs 6 using `FlatList`.**

### 1.3 Dead image assets shipped in every bundle

| Asset | Size | References |
|---|---:|---:|
| `assets/brand/logo-lockup.png` | 628 KB | **0** |
| `assets/brand/logo-mark.png` | 61 KB | **0** |

### 1.4 Startup budgets exceeded (app's own telemetry)

| Marker | Measured | Budget |
|---|---:|---:|
| hydration | 766 ms | 500 ms |
| splash_hide | 2436 ms | 1500 ms |
| interactive | 2443 ms | 2000 ms |

---

## 2. Changes made

| # | Change | File |
|---|---|---|
| 1 | `enableFreeze(true)` — suspends React trees for off-screen screens | `app/_layout.tsx` |
| 2 | `freezeOnBlur: true` on the tab navigator | `app/(tabs)/_layout.tsx` |
| 3 | Bookings list → `FlatList` (`removeClippedSubviews`, `initialNumToRender 4`, `maxToRenderPerBatch 5`, `windowSize 7`), header sections moved to `ListHeaderComponent`, empty states to `ListEmptyComponent` | `app/(tabs)/bookings.tsx` |
| 4 | `BookingCard` wrapped in `React.memo`; stable `keyExtractor` / `renderItem` | `src/components/booking/BookingCard.tsx`, `app/(tabs)/bookings.tsx` |
| 5 | Providers results → `FlatList` with the row extracted into a memoised `ProviderCard` | `app/providers/index.tsx` |
| 6 | Deleted two unreferenced brand PNGs | `assets/brand/` |

Layout is unchanged: rows carry the screen inset via a `rowInset` style, replacing the padding the
old wrapper `View` provided, and `BookingCard` already owned its own vertical margin.

---

## 3. Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | **0 errors** |
| `expo export --platform android` | **exit 0**, Hermes bundle **9.03 MB** |
| Freeze actually active at runtime | ✅ `Freeze (node_modules/react-freeze/src/index.tsx)` present in the rendered tree on device |
| App renders after changes | ✅ Home tab verified on device (real reviews, AI card, live data) |
| PNG assets | 17 files / 3359 KB → **15 files / 2669 KB** (−689 KB) |

### Startup, before vs after

| Marker | Before | After |
|---|---:|---:|
| HOME_RENDER | — | 2341 ms |
| SPLASH_HIDE | 2436 ms | 2380 ms |
| INTERACTIVE | 2443 ms | 2389 ms |

**This delta is ~2% and is within run-to-run noise — it should not be read as an improvement.**
Freezing targets steady-state cost after startup, not cold start. Both runs are dev builds served
by Metro, which is materially slower than a release build; the budgets above are therefore not a
fair judgement of release startup either.

---

## 4. Not verified / still open

- **Scroll frame data was not captured.** `dumpsys gfxinfo com.homigo.mobile` returns
  `Failure while dumping the app` on this device, and the `BufferQueueProducer` fps lines only
  sample when frames are queued. No before/after FPS number exists, so none is claimed.
- **The virtualised bookings and providers screens have not been visually confirmed on device** —
  the phone left USB before that check. They compile and export cleanly; that is all that is proven.
- **`hydration 766 ms`** is unlikely to be data volume: the Zustand `partialize` persists only five
  small fields (`locationId`, `activePromo`, `isDarkMode`, `isPremium`, `wishlistIds`). It is most
  likely AsyncStorage native-module cold init. Moving to MMKV would test that, but it is a
  dependency swap with migration risk and was not done.
- **No `expo-image`.** Ten remote `<Image source={{uri}}>` usages have no blur placeholder or
  crossfade, so avatars pop in. Adding it is a dependency addition and was left for a decision.
- **Remaining PNG weight: 2669 KB across 15 files**, including `house-3d.png` (505 KB) and
  `wallet-3d.png` (269 KB) rendered into small views. Converting these to WebP is the next
  measurable win; not done in this pass because it changes asset files referenced by `require()`.
- The 46 infinite loops still run on the **focused** screen. That is intended — they are the
  ambient design language — but no audit was done of whether each one is visible when it runs.
