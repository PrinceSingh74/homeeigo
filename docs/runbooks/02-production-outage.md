# Runbook 02 — Production Outage (backend down)
**Symptoms:** `/health` 5xx/timeout, HTTP 000.
1. Confirm: `curl -m5 :3000/health`.
2. Postgres up? `docker exec homigo-postgres psql -U postgres -d homigo_db -c "select 1"`. If down → start container, then restart backend.
3. Restart backend: kill PID on :3000, relaunch (`bun --env-file=.env run src/index.ts`).
4. Check boot log for env/migration errors (`production-config` validates JWT/secrets in prod).
5. If recent deploy → **rollback (07)**.
6. Verify: `/health` ok, a test booking flow, financial integrity 100.
