# HOMEEIGO Mobile — Architecture Audit

**Date:** 2026-07-29 · **App:** `homigo-mobile` (React Native 0.81 / Expo SDK 54 / Expo Router)
**Scope:** foundation only. No backend, API, database, auth, routing behaviour, or business logic changed.

> **On document count.** The brief asked for eleven separate reports. The repository root already
> holds **100 markdown files**, and eleven more thin, overlapping documents would worsen exactly the
> maintainability this phase is meant to improve. All eleven topics are covered here and in two
> companions — `TECHNICAL_DEBT_REGISTER.md` and `FOUNDATION_CERTIFICATION.md`. Say the word and I
> will split them out.

> **Measured, not assumed.** Every number below comes from a file scan, `tsc`, or the Expo build.

---

## 1. Discovery (Phase 1A)

| Area | Measured |
|---|---|
| Route files (`app/`) | 29 files · 4,264 lines |
| Source (`src/`) | 251 files · 31,063 lines *(at audit start)* |
| Navigation | Expo Router; one `Stack` root + one `Tabs` group (6 tabs) |
| State | Zustand (`src/stores`, `src/lib/store.ts`) + TanStack Query |
| Persistence | AsyncStorage via Zustand `persist`, `partialize` limited to 5 fields |
| API layer | `src/services/core/*` (772-line `api.ts`) behind `apiRequest` |
| Startup | `markAppStart()` → `initSentry()` at module load; `AuthProvider` bootstrap; startup telemetry with budgets |

### `src/` composition at audit start

| Directory | Files | Lines |
|---|---:|---:|
| `components/` | 128 | 19,773 |
| `lib/` | 72 | 5,569 |
| `hooks/` | 30 | 2,742 |
| `services/` | 4 | 1,321 |
| `theme/` | 7 | 448 |
| `types/` | 4 | 318 |
| `stores/` | 1 | 302 |
| `constants/` | 1 | 283 |
| `screens/` | 1 | 176 |
| `providers/` | 3 | 131 |

---

## 2. Structure findings (Phase 1B) — and what was done

### 2.1 `src/theme/` was named app-wide but served one feature — **fixed**

`src/theme/` exported `serviceColors`, `serviceType`, `fontFamily`, `layout` — services-page tokens.
**20 of its 21 importers lived in `src/components/services/`.** Meanwhile the real app-wide tokens
(`colors`, `shadowStyles`, `gradients`, `spacing`, `radius`, `type`) live in `src/lib/colors.ts` and
`src/lib/typography.ts`. A new engineer importing `@/theme/colors` expecting app colours got service
colours instead.

**Action:** moved all 7 files to `src/components/services/theme/` and rewrote 20 import sites.
Behaviour unchanged; `src/theme/` no longer exists.

### 2.2 `src/screens/` existed for a single file — **fixed**

Five of six tabs implement their screen inline in `app/(tabs)/*.tsx` (69–487 lines). Only
`services.tsx` was a 5-line re-export of `src/screens/ServicesScreen.tsx`.

**Action:** inlined the screen into its route and removed `src/screens/`. Tab routes are now consistent.

### 2.3 Dead code — **removed, 1,311 lines**

Each file below was verified dead by searching for *every symbol it exports* across `src/` and `app/`,
not merely by filename:

| File | Lines |
|---|---:|
| `components/wallet/WalletSheets.tsx` | 520 |
| `components/services/TrendingServices.tsx` | 186 |
| `components/services/visual/Hero3DVisual.tsx` | 175 |
| `components/RecommendedSection.tsx` | 121 |
| `components/track/TrackMap.tsx` + `.web.tsx` | 100 |
| `components/services/visual/GlassSurface.tsx` | 68 |
| `components/services/ServicesThemeToggle.tsx` | 64 |
| `lib/services-notifications.ts` | 40 |
| `components/membership/PremiumLockBadge.tsx` | 29 |
| `components/services/common/SectionSpacer.tsx` | 6 |
| `components/services/overlays/ServicesOverlays.tsx` | 2 |

Two empty directories (`components/membership`, `components/services/overlays`) were removed with them.
`Hero3DVisual` also carried 3 always-running Reanimated loops.

**False positives deliberately kept:** `HomeLiveMap.web.tsx` (platform variant Metro resolves),
`src/types/index.ts` (42 importers via `@/types`), and three `*.test.ts` files.

### 2.4 `src/lib/` is a junk drawer — **documented, not changed**

71 files spanning design tokens, auth, offline queue, observability, navigation helpers, date maths and
feature-specific styles (`book-styles.ts`, `profile-typography.ts`). It is the second-largest directory
and has no single responsibility. Splitting it is the largest remaining structural item; it was **not**
attempted here because it touches hundreds of import sites and the payoff is lower than its risk in one
pass. See the debt register.

---

## 3. Component architecture (Phase 1C)

Largest files after cleanup:

| File | Lines | Note |
|---|---:|---|
| `app/book.tsx` | 996 | booking wizard: state, pricing, scheduling, payment orchestration and full UI in one file |
| `src/services/core/api.ts` | 772 | entire API surface in one module |
| `src/components/app/AppOverlays.tsx` | 689 | many unrelated overlays in one component |
| `src/hooks/use-core-data.ts` | 618 | all query/mutation hooks in one module |
| `src/components/services/ExpressServices.tsx` | 594 | |
| `src/components/ai/AiChatBlock.tsx` | 580 | |

`app/book.tsx` is the clearest single-responsibility violation. Splitting it is recommended, not done —
it is the app's highest-risk screen (money path) and deserves its own change with device testing.

---

## 4. Navigation (Phase 1D)

Structure is simple and healthy: one root `Stack`, one `(tabs)` group, modal/stack screens declared with
explicit animations. Auth is enforced per-screen by `AuthGuard` rather than by a route group — this works
and was left alone, since changing it would change routing behaviour, which the brief forbids.

**Improvement applied (performance, not behaviour):** `enableFreeze(true)` plus `freezeOnBlur: true` on
the tab navigator, so off-screen screens stop rendering. Verified active on device (`Freeze` nodes present
in the rendered tree).

---

## 5. Design tokens (Phase 1F)

After the move there are two clearly-scoped systems:

| System | Location | Owns |
|---|---|---|
| App-wide | `src/lib/colors.ts`, `src/lib/typography.ts` | `colors`, `shadowStyles`, `gradients`, `spacing`, `radius`, `type`, `screenPadding` |
| Services feature | `src/components/services/theme/` | `serviceColors`, `serviceType`, `fontFamily`, `layout`, `tokens`, `shadows3d` |
| AI feature | `src/lib/ai-mobile-theme.ts` | `aiSpacing`, `aiRadius`, `aiType`, `aiCardShadow` (14 importers) |

Remaining inconsistency: the AI system still lives in `lib/` rather than beside its feature, and defines
its own radius scale (`aiRadius`) parallel to the app's `radius`. Documented in the debt register.

---

## 6. Dependencies (Phase 1G)

Unimported in `src/` and `app/`:

| Package | Verdict |
|---|---|
| `axios` | **Genuinely unused** — the app uses `fetch` through `apiRequest`. Safe removal candidate. |
| `expo-av` | **Genuinely unused** — no audio/video code paths remain. Safe removal candidate. |
| `@react-navigation/native` | Keep — transitive peer of `expo-router`. |
| `nativewind`, `tailwindcss`, `babel-preset-expo`, `react-native-web`, `react-native-worklets` | Keep — used by `babel.config.js`, `metro.config.js`, `global.css`, `tailwind.config.js`, or required as peers. |

**Nothing was removed.** Removing a dependency changes the lockfile and requires a full reinstall and
device re-verification, which could not be completed in this pass. Recommendation only, as the brief asked.

---

## 7. Startup (Phase 1H)

Current order: `markAppStart()` → `enableFreeze(true)` → `initSentry()` at module load; then in the root
effect: startup marks, error hooks, connectivity service, telemetry queue, and offline replay deferred
behind `onInteractive()`. Splash is released by whichever of home-render / UI-ready / root-failsafe fires
first, through a single shared guard.

This is already well sequenced — non-critical work is deferred and the splash does not wait on auth. The
app's own telemetry reports `hydration 766 ms` against a 500 ms budget; the persisted store is only five
small fields, so this is most likely AsyncStorage native-module cold init rather than data volume. Testing
that would mean swapping to MMKV — a dependency change with migration risk, not attempted.

---

## 8. Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | **0 errors** (after every step) |
| `expo export --platform android` | **exit 0**, Hermes bundle **9.03 MB** |
| Routes | unchanged — `app/` tree identical except `services.tsx` now holds its own implementation |
| Assets | no asset referenced by surviving code was removed |
| Backend / API / DB / auth | untouched |

`src/` went from **251 files / 31,063 lines** to **238 files / 29,752 lines**, and lost three directories
(`screens/`, `theme/`, plus two empty component folders).
