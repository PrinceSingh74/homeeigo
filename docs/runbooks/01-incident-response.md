# Runbook 01 — Incident Response (general)
**Trigger:** any P1/P2 alert (Alertmanager), customer/partner outage report.
1. **Acknowledge** the alert; declare severity (P1=full outage, P2=degraded).
2. **Triage:** check `/health` + `/ready` (backend), Grafana dashboards, `docker ps` (homigo-postgres up?).
3. **Identify layer:** API / DB / Redis / WS / payments / maps (see specific runbooks 02–08).
4. **Mitigate** (rollback 07, restart, failover) before root-cause.
5. **Communicate:** status to stakeholders every 15 min.
6. **Post-incident:** write a timeline; file follow-ups.
**Key checks:** `curl :3000/health`, `docker exec homigo-postgres psql -U postgres -d homigo_db -c "select 1"`, financial integrity `bun run p2:wallet-integrity`.
