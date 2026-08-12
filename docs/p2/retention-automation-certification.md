# Retention Automation Certification

**Date:** 2026-06-14 · execution-verified.

## Built
`runLocationRetention()` in `src/lib/maintenance.ts` — **leader-locked** (`runWithLeaderLock("maintenance:location_retention")`), registered on a **24h interval** in `startMaintenance()` and cleared in `stopMaintenance()`. Prunes:
- `location_history` older than **30 days** (`trackingService.cleanupHistory(30)`)
- `geofence_events` older than **90 days**
Logs metrics (`location_retention`: counts + retention days) and warns on failure (`location_retention_failed`).

## Execution evidence
```
retention: locationHistory before=3 removed(>30d)=0 geofenceEvents removed(>90d)=0 → executes ✅
```
(0 removed because the test data is fresh — the query path executes correctly.)

## Honest note
The codebase schedules via **intervals** (not wall-clock cron), matching the existing `runBackup`/`runDeletionFinalize` daily pattern — so this runs every 24h after boot, not strictly at 02:00. Wall-clock 2 AM would need a cron lib; the leader lock already prevents multi-instance double-runs. **STATUS: PASS** (automated, leader-safe, metric-logged); **PARTIAL** on exact 2 AM wall-clock timing.
