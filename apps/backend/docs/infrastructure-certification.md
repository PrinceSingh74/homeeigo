# Infrastructure Certification

**Overall verdict:** PASS

**Executed:** 2026-06-25T11:12:31.595Z
**Run ID:** `infra-mqtei14k`
**Command:** `bun --env-file=.env run scripts/infrastructure-certification.ts`

| Drill | Verdict | Evidence | Metrics |
|-------|---------|----------|---------|
| 1. Real infrastructure kill test | **PASS** | port=3000 before=200 down=503 recovered=true pg=true redis=true | {"recoveryMs":41,"ownedBackend":0} |
| 2. Backup restore certification | **PASS** | backup + scratch restore integrity verified (local dump only; production dump NOT PROVEN) | {"productionDump":0} |
| 3. Multi-node certification | **PASS** | instances=2/2 ports=3000,3022 redis=redis://localhost:6379 cluster exit=0 | {"sharedPostgres":1,"clusterValidation":1} |
| 4. Production monitoring drill | **PASS** | alerts=0 grafana=0 observability exit=0 port=3000 | {"alerts":0,"grafana":0,"liveObs":1} |

## Scope notes

- **Kill test:** real `docker stop` on `homigo-postgres` + `homigo-redis`; probes live `/ready` on primary backend.
- **Backup restore:** local `pg_dump` + scratch DB restore. Production dump restore is **NOT PROVEN** unless `PRODUCTION_DUMP_FILE` is supplied.
- **Multi-node:** 2 backend processes (`:3000` + `:3022`) + shared Redis (`cluster-validation.ts`) + shared PostgreSQL (`DATABASE_URL`). Redis coordination **PASS**; second OS process **NOT PROVEN** when Postgres connection pool is saturated on dev.
- **Monitoring:** static alert/Grafana audit + live `/metrics` + `/ready` probes.
