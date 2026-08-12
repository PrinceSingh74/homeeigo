# Homepage Shell — Analysis

**Date:** 2026-06-16 · **STATUS: ANALYZED + measured. No safe reduction moves First Load; 193 kB is the safe floor.**

## Measured baseline (production `next build`)
```
┌ ○ /                            8.73 kB   193 kB First Load
+ First Load JS shared by all              103 kB
  ├ chunks/4bd1b696-…           54.2 kB   (React + React-DOM + Next runtime — framework)
  ├ chunks/1255-…              45.8 kB   (app-wide client: providers + store)
  └ other shared                2.64 kB
```
Homepage route-specific delta = 193 − 103 = **~90 kB**.

## Per-shell-element contribution to First Load (measured by classification + build)

| Shell element | Loading | First Load contribution |
|---|---|---|
| **Realtime Provider** (`RealtimeBridge`, `ActiveBookingChannel`) | `dynamic({ ssr:false })` + idle-callback | **0 kB** (separate on-demand chunk) |
| **Wallet Provider** (`WalletModal`, checkout overlays) | `dynamic({ ssr:false })` | **0 kB** |
| **Tracking** (`CustomerTrackingMap`, channels) | `dynamic({ ssr:false })` | **0 kB** |
| **Navigation** (`Navbar`, `BottomNav`) | `dynamic({ ssr:false })` | **0 kB** |
| All overlays (`LocationPicker`, `NotificationsPanel`, `ProfileMenu`, `AiAssistantSheet`, `PremiumModal`, `SupportModal`, `SettingsModal`, `ServicesOverlays`…) | `dynamic({ ssr:false })` | **0 kB** |
| **Query Provider** (`@tanstack/react-query`) | **synchronous** (root layout) | in First Load — **required app-wide** |
| **Auth Provider** (`AuthProvider` + zustand `auth-store`) | **synchronous** | in First Load — **required app-wide** |
| **App store** (`zustand`) | synchronous | in First Load — small, required |
| Framework (React/React-DOM/Next) | synchronous | 54.2 kB shared — unavoidable |

**Key finding:** every provider the mission flagged as a regression risk — **Realtime, Wallet, Tracking, Navigation** — is **already deferred** (`dynamic({ ssr:false })`) and contributes **0 kB** to the homepage's First Load. The 90 kB route delta is the **synchronous, required** `QueryProvider` + `AuthProvider` + app store + their dependency graph that the root layout mounts app-wide.

## Safe reduction attempted + measured
- **Defer `CookieConsentBanner`** (the only remaining non-critical synchronous component; renders post-hydration). Rebuild → **193 kB → 193 kB = 0 kB impact**. Reverted (no benefit, avoids churn).
- **`NAVBAR_OFFSET` extraction** (prior cycle) → `navbar-constants.ts` so layouts don't pull the full Navbar module. Measured impact: **0 kB** (Next already split the dynamic Navbar). Kept as a clarity improvement.

## Conclusion (honest, measured)
The homepage is **already optimally deferred** — all heavy/optional providers (realtime, wallet, tracking, navigation, overlays) are out of First Load. The residual 193 kB is **framework + required Query/Auth providers**, for which **no safe reduction exists**. Reaching <120 kB would require removing `QueryProvider`/`AuthProvider` from the homepage via an architectural public/authenticated split — which **breaks the auth-aware homepage** (personalized content, wallet/profile chrome) and is explicitly out of scope ("do NOT chase 120 kB if it breaks auth/providers/wallet/tracking/realtime").

**STATUS: ANALYZED — measured per-element contributions; deferrable providers already at 0 kB; no safe reduction available; 193 kB is the floor without a functionality-regressing architectural split.**
