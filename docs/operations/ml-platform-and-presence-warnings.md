# Two recurring runtime warnings — traced, not silenced

2026-09-23. Both were audited to root cause. Neither was suppressed, downgraded, or hidden.

## `ml_platform_not_serviceable`

**What it says.** `mlPlatformHealthService.health()` runs four checks — `etl_pipeline`,
`warehouse_freshness`, `forecast_horizon`, `registry_reconciliation` — and reports the platform
unserviceable when any of them FAILs.

**Root cause.** The ETL has not succeeded since BigQuery billing was disabled, so `etl_pipeline`
fails on freshness and `warehouse_freshness` / `forecast_horizon` fail behind it. The check is
arithmetically correct and the condition is real: this is **intentionally unavailable
infrastructure**, not a product failure.

**Why it repeated thousands of times.** `health()` is registered as a *scrape sampler*, so it ran —
and logged — on every Prometheus scrape. One long-standing condition was producing an identical WARN
line every few seconds, which buries the line that actually matters: the moment the failing set
changes.

**What changed.** The *logging cadence*, and nothing else:

* `ml_platform_serviceable` and `ml_platform_check_state` gauges are still set on **every** sample —
  that is the channel an alert should watch, and it is untouched;
* the verdict is still computed the same way (`failed.length === 0`), still FAIL, never downgraded;
* the log now fires on a **transition**, on the first occurrence, and as an hourly heartbeat, and
  carries `transition: "changed" | "ongoing"` so a reader can tell a new failure from a standing one;
* **recovery is logged too** (`ml_platform_serviceable` at INFO), so the logs are not only ever a
  record of the bad state.

**Product impact: none, and that is verified rather than assumed.** No ML output reaches a customer
or a partner today:

| Model | State |
|---|---|
| cancellation risk | `NOT_SERVING` — offline evaluation, nothing consumes the score |
| provider acceptance | `NOT_SERVING` — the assignment engine does not consume it |
| support classification | has a deterministic fallback; a support screen always has something to show |

`runtime-warning-controls.test.ts` holds this: if a model is ever wired into a product path while
the platform is unserviceable, the warning stops being noise and the test says so.

## `presence_sweep … expired=1 locationStale=1`

**Root cause, measured on `homigo_db`.** There is exactly **one** `partner_presence` row —
`partner@homigo.demo`, the dev partner — and its last heartbeat was 333 minutes old at the time of
measurement. The partner app is simply not running. Not a heartbeat bug, not corrupted seed data,
not a fleet problem.

A 5.5-hour gap looks suspiciously like the IST offset, so that was checked rather than assumed: the
database session timezone is UTC, `NOW()` and `last_heartbeat_at` are both UTC, and the gap is real.

**The control that makes it safe.** `matching.service` filters candidates through
`passesPresenceLocationGate(evidence)` in both matching paths — availability is the partner's own
switch, presence is whether we have heard from them, and trusting the switch alone would dispatch to
a phone that died hours ago. A stale or expired partner is therefore never dispatchable.

**What was deliberately not done.** No heartbeat or location was written to quieten the sweep.
Freshening presence to make a number go down would make every downstream dispatch decision a lie;
`runtime-warning-controls.test.ts` asserts the sweep only ever reads and emits.

The sweep logs at INFO with its thresholds included (`staleThresholdSec`, `locationStaleThresholdSec`)
and exports `partner_location_stale_total` as a gauge. That is appropriate for a correct observation
about a dev environment, and it was left alone.
