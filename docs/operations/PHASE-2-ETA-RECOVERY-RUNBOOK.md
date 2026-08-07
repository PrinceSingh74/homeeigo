# Phase 2 ETA Intelligence — Recovery Runbook

**Scope:** Label collection platform (no ML inference)  
**Owner:** Platform / SRE  
**Last Updated:** 2026-08-07

---

## Symptoms & Actions

### Missing labels after booking completion

1. Verify outbox processor is running: `homigo_outbox_pending_total` metric
2. Check `eta-label.v1` consumer receipts: `event_consumer_receipts` table
3. Confirm booking has `arrivedAt` and `status = COMPLETED`
4. Manually trigger label collection:
   ```bash
   bun run --env-file=.env -e "
   import { etaIntelligenceService } from './src/services/eta-intelligence.service';
   await etaIntelligenceService.collectLabelFromBooking('BOOKING_ID');
   "
   ```

### BigQuery sync deferred

Labels persist in PostgreSQL even when BQ load fails. Recovery:

```bash
bun run --env-file=.env scripts/deploy-bigquery-ddl.ts
# Then trigger ETL
curl -X POST /api/analytics/etl/run -d '{"jobIds":["etl.eta"],"runMode":"FULL"}'
```

### Low label quality score

1. Check rejection reasons: `GET /api/analytics/eta/quality`
2. Common causes:
   - `missing_timestamps` — partner never went en-route or dispatch not recorded
   - `gps_jump` — sparse GPS or spoofed location
   - `negative_duration` — clock skew; investigate assignment timestamps

### Google snapshot failures

1. Verify `GOOGLE_MAPS_API_KEY` is set
2. Check `homigo_eta_google_latency` and circuit breaker state
3. Haversine fallback does not block collection; labels still created with `google_eta_seconds` from booking.eta

---

## DLQ Replay

Failed eta-label consumer events appear in `event_dead_letters`. Replay via existing Phase 0 DLQ replay tooling.

---

## Rollback

Phase 2 is additive. To disable label collection without removing code:

```env
# No dedicated flag — consumer always registered.
# To pause: stop processing BOOKING_COMPLETED in eta-label consumer via feature flag (future).
```

Database rollback requires migration revert of `20260807140000_phase2_eta_intelligence`.

---

## Monitoring

- Grafana: `homigo-eta-intelligence` dashboard
- Alerts: `EtaMissingLabels`, `EtaLabelQualityLow`, `EtaLabelFailureSpike`
- Admin UI: `/eta-intelligence`
