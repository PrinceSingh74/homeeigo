# Mobile Performance Audit

**Scope:** `homigo-mobile` — TrackMap, AiLiveTrackingMap, tracking/booking/wallet screens  
**Method:** Static code audit + targeted optimizations (no on-device FPS probe in this run)

## Changes Applied

| Component | Change |
|-----------|--------|
| `TrackMap.tsx` | Wrapped in `React.memo`; `fitToCoordinates` only on coordinate change |
| `AiLiveTrackingMap.tsx` | Infinite Reanimated loops gated by `AppState === "active"`; `Rider3D` / `LiveDot` respect `animate` flag |
| Maps | Native `react-native-maps` — no web SDK DOM inflation on mobile |

## Static Analysis

### Infinite Animation Loops (Before)

| Location | Loop | After |
|----------|------|-------|
| `AiLiveTrackingMap` dashOffset | `withRepeat(-1)` | Paused when app backgrounded |
| `AiLiveTrackingMap` shine/homeBob/pickupPing | `withRepeat(-1)` | Paused when app backgrounded |
| `Rider3D` bob/pulse/trail | `withRepeat(-1)` | Gated by `animate` prop |
| `LiveDot` | `withRepeat(-1)` | Gated by `animate` prop |
| `TrackMap` | None (single fit effect) | ✅ |

### Rerender Risk

| Component | Risk | Mitigation |
|-----------|------|------------|
| `TrackMap` | Parent location updates | `memo` + effect deps on coordinates only |
| `AiLiveTrackingMap` | Layout changes | `useTrackingLayout` hook isolated |

### Duplicate API Requests

Mobile tracking screens use shared React Query hooks — no duplicate request pattern identified in track components.

## Runtime Metrics

| Metric | Value | Source |
|--------|-------|--------|
| FPS | **Not measured** | Requires Expo dev client / Flipper on device |
| Memory | **Not measured** | Requires Xcode Instruments / Android Profiler |
| CPU | **Not measured** | Requires on-device profiling |
| JS thread time | **Not measured** | Requires Reanimated/Perf monitor |

## Certification Status

| Check | Status |
|-------|--------|
| Memoize maps | ✅ `TrackMap` memoized |
| Reduce idle animations | ✅ AppState gating |
| Dynamic import maps | N/A (native MapView) |
| Runtime FPS/Memory/CPU | ❌ **No device probe run** |

**Honest gap:** Mobile certification requires on-device profiling (Flipper, Expo Performance, or release build benchmarks). Code-level optimizations are in place; runtime FPS/memory claims are **not certified** in this closure pass.
