# HOMEEIGO Mobile — Technical Debt Register

**Date:** 2026-07-29 · Companion to `MOBILE_ARCHITECTURE_AUDIT.md`
Items are ordered by severity. Anything already fixed in this pass is listed at the bottom for the record.

---

## CRITICAL

*(none open)* — the two items that would have qualified, a fabricated booking card shown to every user
and a dead payment CTA, were fixed in an earlier pass and are recorded in `AI_ASSISTANT_MOBILE_AUDIT.md`.

---

## HIGH

### H1 — `app/book.tsx` is 996 lines and owns the money path
- **Problem:** service selection, package/add-on state, date-time parsing, pricing, address creation, booking creation, Razorpay orchestration and the entire UI live in one file.
- **Impact:** the highest-risk screen in the product is the hardest to reason about or test.
- **Risk of leaving it:** a regression here costs real money; the earlier payment-sequencing and wrong-date bugs both lived in this area.
- **Solution:** extract `useBookingDraft` (selection + schedule state), `useBookingCheckout` (create → pay → verify), and move the wizard sections into `src/components/booking/`. Keep the route file as composition only.
- **Complexity:** High — must be paired with on-device payment testing.

### H2 — `src/lib/` has no single responsibility (71 files)
- **Problem:** design tokens, auth, offline queue, observability, navigation helpers, date maths and feature-specific styles share one folder.
- **Impact:** discovery cost for every new engineer; encourages further dumping.
- **Solution:** split into `src/design/`, `src/auth/`, `src/offline/`, `src/observability/`, `src/utils/`, and move feature-specific styles (`book-styles.ts`, `profile-typography.ts`, `ai-mobile-theme.ts`) next to their features.
- **Complexity:** Medium mechanically, but touches hundreds of import sites — do it as one dedicated, `tsc`-verified change, not alongside feature work.

### H3 — `src/services/core/api.ts` is 772 lines
- **Problem:** the whole backend surface in one module; every screen importing one endpoint pulls the file.
- **Solution:** split by domain (`bookings`, `payments`, `providers`, `wallet`, `geo`, `auth`) behind the existing `coreApi` object so call sites do not change.
- **Complexity:** Medium. Low risk — pure re-export refactor.

---

## MEDIUM

### M1 — Three parallel design-token systems
App-wide (`lib/colors`, `lib/typography`), services (`components/services/theme/`), AI (`lib/ai-mobile-theme`). The AI system defines `aiRadius`/`aiSpacing` parallel to the app's `radius`/`spacing`.
- **Solution:** move the AI tokens beside the AI feature and express them as overrides of the app scale rather than a parallel one.
- **Complexity:** Medium.

### M2 — `AppOverlays.tsx` is 689 lines of unrelated overlays
- **Solution:** one file per overlay, composed by a small registry.
- **Complexity:** Medium.

### M3 — `use-core-data.ts` is 618 lines of every query and mutation
- **Solution:** split per domain, mirroring H3.
- **Complexity:** Low–Medium.

### M4 — Two unused dependencies (`axios`, `expo-av`)
- **Impact:** install size and audit noise; `axios` in particular implies an HTTP client the app does not use.
- **Solution:** remove, reinstall, re-verify on device.
- **Complexity:** Low, but needs a device pass — not done here for that reason.

### M5 — 100 markdown files in the repository root
- **Impact:** the audit trail is now itself unnavigable; overlapping certifications make it unclear which is current.
- **Solution:** move to `docs/` with dated subfolders and a single index.
- **Complexity:** Low.

---

## LOW

### L1 — `2,669 KB` of PNG assets, some rendered small
`house-3d.png` (505 KB) and `wallet-3d.png` (269 KB) are decoded at full size into small views. Converting to WebP is the next measurable bundle win.

### L2 — No `expo-image`
Ten remote `<Image source={{uri}}>` usages have no placeholder or crossfade, so avatars pop in.

### L3 — `hydration 766 ms` against a 500 ms budget
Likely AsyncStorage native cold init, not data volume (only five fields persisted). Testing means trialling MMKV.

### L4 — 46 infinite Reanimated loops, none focus-aware individually
Now mitigated for off-screen screens by `enableFreeze` + `freezeOnBlur`, but no audit exists of whether each loop is visible while it runs on the focused screen.

### L5 — Auth enforced per-screen by `AuthGuard` rather than by route group
Works correctly; a `(protected)` group would express intent better but would change routing behaviour, which was out of scope.

---

## Fixed in this pass

| Item | Evidence |
|---|---|
| `src/theme/` named app-wide but served only the services feature | moved to `src/components/services/theme/`, 20 imports rewritten, `tsc` 0 |
| `src/screens/` existed for one file while 5/6 tabs were inline | inlined into `app/(tabs)/services.tsx`, directory removed |
| 1,311 lines of dead code across 12 files | each verified dead by exported-symbol search; `tsc` 0 and `expo export` exit 0 after removal |
| Two empty component directories | removed |
| Off-screen screens kept rendering and animating | `enableFreeze(true)` + `freezeOnBlur: true`, verified active on device |
| Bookings and providers lists were unvirtualised | converted to `FlatList` with memoised rows |
| 689 KB of unreferenced image assets | `logo-lockup.png`, `logo-mark.png` — 0 references |
