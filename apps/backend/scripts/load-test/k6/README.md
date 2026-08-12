# HOMIGO k6 Load Tests

Real-flow load tests for booking, payment, and wallet. Install k6
(`winget install k6` / `brew install k6` / Docker `grafana/k6`).

## Scales (P2 scope)

`-e STAGE=` sets peak VUs. Ramp: 25% → peak → sustain → drain.

```bash
k6 run -e STAGE=100  scripts/load-test/k6/booking.js
k6 run -e STAGE=500  scripts/load-test/k6/booking.js
k6 run -e STAGE=1000 scripts/load-test/k6/booking.js
```

## Common env

| Var | Purpose |
|---|---|
| `BASE_URL` | API base (default `http://localhost:3000`) |
| `STAGE` | peak VUs: 100 / 500 / 1000 |
| `LOGIN_EMAIL` / `LOGIN_PASSWORD` | enable authenticated flows |
| `ALLOW_WRITES=1` | **STAGING ONLY** — enable mutating flows |
| booking: `PROVIDER_ID`, `SERVICE_ID` · payment: `BOOKING_ID` · wallet: `TRANSFER_TO`, `GIFT_CARD_CODE` | ids for write flows |

## SLO thresholds (fail the run if breached)

- `homigo_latency_ms`: p95 < 500ms, p99 < 1200ms
- `homigo_errors`: rate < 1% · `http_req_failed`: rate < 5%

## Evidence

Each run writes `docs/p2/evidence/k6-<scenario>-<stage>.json` (via `handleSummary`).
After a wallet run, gate with `bun run p2:wallet-integrity` to confirm no
double-spend / negative balance / ledger drift was introduced under concurrency.
