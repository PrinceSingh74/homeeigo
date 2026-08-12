# HOMEEIGO Mobile — Performance Report (Phase 2)

**Date:** 2026-07-30 · **App:** `homigo-mobile` (React Native 0.81 / Expo SDK 54)
**Device:** Realme RMX3943, Android 15, USB · **Build:** development build served by Metro
**Constraints honoured:** no backend, API, database, auth, routing or business-logic change. The
shared backend remains the single source of truth; every change is client-side only.

> **Evidence rule.** Every number below was produced by `scripts/perf-measure.sh` or by counting
> lines in the Metro session log. Where a measurement was attempted and turned out **not** to support
> the change, that is written down as such. Nothing is estimated.

---

## 1. Measurement harness

Ad-hoc `adb` calls are not reproducible, so the probe is committed as
**`homigo-mobile/scripts/perf-measure.sh`**:

```
scripts/perf-measure.sh <label> [metro-log-path]
```

It emits `label.metric=value` lines covering PSS/RSS, native and Dalvik heap, live `Views`, CPU %,
and `gfxinfo` frame totals plus jank percentage and p50/p90/p95/p99 frame times, then resets the
frame counters so the next run measures a fresh window.

Two probe caveats are encoded in the script because both bit this session:
`dumpsys gfxinfo` intermittently answers `Failure while dumping the app` when the process is busy
(it is retried and reported as `UNAVAILABLE` rather than silently skipped), and `BufferQueueProducer`
fps lines only appear while frames are being queued, so they are not used.

---

## 2. Proven: background polling now stops

### The defect

`useBookingsQuery` polls every 8s while any booking is `pending`/`accepted`/`in_progress`. React
Query on React Native has no notion of "app backgrounded" unless `focusManager` is bridged to
`AppState` — and it was not. `onlineManager` was already bridged to NetInfo in the same file; the
focus half was simply missing, so the poll ran on regardless of whether anyone was looking.

Evidence of the cost, from a session captured **before** the fix — request counts with query strings
stripped:

| Endpoint | Requests |
|---|---:|
| `GET /api/users/bookings` | **1,548** |
| `GET /api/geo/route` | 236 |
| `GET /api/ratings/recent` | 176 |
| `GET /api/tracking/<id>` | 170 |

`/api/users/bookings` was fetched 6.5× more than the next endpoint.

### The measurement

Bridging `focusManager` to `AppState`, then measuring with the app **verified backgrounded before and
throughout** each window (the check is gated — if the app returns to the foreground mid-window the
result is discarded):

| State | Duration | `/api/users/bookings` |
|---|---|---:|
| Foreground, authenticated, active booking | 40 s | **+8** |
| **Backgrounded (verified continuously)** | 45 s | **+0** |
| Foreground again | 40 s | **+8** |

Polling stops completely while backgrounded and resumes on return. At the foreground rate that is
roughly **9 fewer requests per backgrounded minute**, each one a radio wake-up.

### Two earlier attempts that were wrong

Recorded because they explain why the first runs looked like failures:

1. `KEYCODE_HOME` did not always background the dev-client app. `mCurrentFocus` still showed
   `com.homigo.mobile`, so the "+11 while backgrounded" reading was measuring the foreground.
2. A later run showed "polling did not resume", which turned out to be the app being **logged out**
   (`→ 401`); `useBookingsQuery` is `enabled: isAuthenticated`, so the query was simply off.

Both were measurement errors, not code failures. The gated method above removes them.

---

## 3. Measured and **not** supported: the retry change

A separate defect was that queries retried settled 4xx responses. `/api/tracking/<id>` answered 404
throughout the baseline session, and the query carried `retry: 3`. The reasoning was that each miss
therefore cost four requests.

**The data does not support that.** Requests per 404 miss:

| Session | tracking requests | 404s | requests per miss |
|---|---:|---:|---:|
| Before the change | 465 | 201 | **2.31** |
| After the change | 13 | 6 | **2.17** |

The amplification was never 4×, and 2.31 → 2.17 is well inside noise on a 13-request sample. **No
performance benefit is claimed for this change.**

It is nevertheless kept, on correctness grounds rather than performance:

- Retrying a settled 404/403/400 cannot succeed, so the requests are pure waste even if the volume is
  small; 408 and 429 are still retried, and 5xx and network failures keep the full budget.
- More importantly, mutations no longer replay a 4xx. **A retried `POST` on a 4xx can duplicate a
  booking or a payment**, and this session has already seen an accidental duplicate booking. That is a
  safety property, not a speed one.

---

## 4. Standalone device baseline

Captured after a cold start, driving a scripted interaction (open Bookings tab, eight scrolls):

| Metric | Value |
|---|---:|
| TOTAL PSS | 826,890 KB (~807 MB) |
| TOTAL RSS | 950,060 KB |
| Native heap | 393,639 KB |
| Dalvik heap | 51,088 KB |
| Live `Views` | 2,475 |
| CPU during scroll | 85.7 % |
| Frames rendered | 91 |
| **Janky frames** | **51 (56.04 %)** |
| p50 / p90 / p95 / p99 frame time | **27 / 150 / 200 / 800 ms** |

A p50 of 27 ms is ~37 fps, and 56 % of frames missed their deadline during the scroll. This is a
**development build over Metro**, which is materially slower than release, so the absolute numbers are
not a release verdict — but they are a valid baseline for comparing future changes measured the same way.

### Why there is no before/after for frames or memory

A second capture was taken after the changes and is deliberately **not** presented as an improvement:

| Metric | first capture | second capture |
|---|---:|---:|
| PSS | 826,890 KB | 1,039,954 KB |
| Live `Views` | 2,475 | 4,613 |
| CPU | 85.7 % | 190 % |
| Janky frames | 56.04 % | 40.98 % |

The two runs are **not comparable**. The first was on a freshly cold-started process; the second was on
a long-lived one that had been through repeated navigation, two logins, several background cycles and
Fast Refresh reloads. The `Views` count nearly doubling is accumulated mounted screens from that
testing, not an effect of any code change — and neither the `focusManager` bridge nor the retry policy
touches scroll rendering, so a frame delta from them would not be credible anyway.

A valid comparison needs a cold start plus the identical script on both builds. The harness now makes
that repeatable; it was not run because the changes in this phase are not expected to move frames.

---

## 5. Investigated and **disproven**: "view accumulation"

An earlier draft of this report named view accumulation the top remaining bottleneck, on the strength of
seeing 2,475 live views on one capture and 4,613 on another. That was wrong, and measuring it properly
is what showed the error.

**Controlled test — visit every tab, then return:**

| Step | Live `Views` | PSS |
|---|---:|---:|
| Fresh cold start, Home | 1,080 | 679,010 KB |
| All six tabs visited | 1,117 (**+3.4 %**) | 675,481 KB |
| Back on Home | 1,116 | **667,737 KB** |

Views grew 3.4 % across the entire tab set and **PSS went down**.

**Controlled test — push and pop stack screens six times:**

| Step | Live `Views` | PSS |
|---|---:|---:|
| Before pushes | 2,513 | 790,480 KB |
| After 3 × push/pop | 2,368 | 878,725 KB |
| After 3 more | **2,109** | **666,453 KB** |

Views *decreased*. There is no monotonic growth and therefore **no view or memory leak from navigation**.
The 2,475 → 4,613 figures came from a session carrying Fast Refresh reloads, two logins and repeated
force-stops — development tooling, not application behaviour.

### A related suspicion, also disproven

Six bottom sheets (`BookingDetailSheet` at 491 lines, `MembershipSheet`, `GiftCardsSheet`,
`SendMoneySheet`, `HCoinsSheet`, `LocationSheet`) have no `if (!visible) return null` guard, which looked
like they were rendering full trees while hidden. Reading the actual React Native source settles it:

```js
// node_modules/react-native/Libraries/Modal/Modal.js
render(): React.Node {
  if (!this._shouldShowModal()) {
    return null;
  }
```

`Modal` already returns `null` when `visible !== true`, so the children are never mounted. Adding those
six guards would have been placebo work.

---

## 6. Remaining bottlenecks, ranked

1. **56 % janky frames on the bookings scroll**, p50 27 ms — measured in a **dev build**, so a release-build
   run with the same harness is the necessary first step before optimising anything.
2. **`app/book.tsx` — 996 lines on the money path.** Split into `useBookingDraft` / `useBookingCheckout`; needs paired on-device payment testing.
4. **2,669 KB of PNGs**, including `house-3d.png` (505 KB) and `wallet-3d.png` (269 KB) rendered into small views. WebP conversion is the next bundle win.
5. **No `expo-image`** — ten remote images have no placeholder or crossfade.
6. **`axios` and `expo-av` unused** — removal changes the lockfile and needs a reinstall plus device re-verification.
7. **The 8s bookings poll duplicates the tracking WebSocket.** Consolidating onto the socket would remove the poll entirely, but proving the socket covers every status transition needs backend-behaviour testing.
