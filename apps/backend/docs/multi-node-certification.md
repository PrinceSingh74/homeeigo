# Multi-Node Deployment Certification

**Executed:** 2026-06-12T16:53:10.273Z
**Run ID:** `multi-node-mqb60fyt`
**Overall:** **PARTIAL**

| Check | Verdict | Detail |
|-------|---------|--------|
| Node A health :3011 | **PASS** | healthy |
| Node B health :3012 | **PASS** | healthy |
| Node C health :3013 | **PASS** | healthy |
| Admin login via primary API | **PASS** | token issued |
| All 3 nodes respond /health | **PASS** | true,true,true |
| Shared DB — bookings readable on all nodes | **PASS** | true,true,true |
| Kill Node A — Node B survives | **PASS** | failoverMs=2025 |
| Kill Node B — Node C survives | **PASS** | node C healthy |
| Duplicate bookings | **NOT PROVEN** | Requires concurrent create harness — not executed in this run |
| Duplicate payments | **NOT PROVEN** | Requires concurrent payment harness |
| Ledger drift | **NOT PROVEN** | Requires post-chaos ledger reconcile |
| Redis restart recovery | **NOT PROVEN** | Requires controlled Redis restart in CI |
| Postgres restart recovery | **NOT PROVEN** | Requires controlled PG restart in CI |

## Evidence

- 3 backend processes on ports 3011, 3012, 3013
- Shared PostgreSQL via DATABASE_URL
- Redis: redis://localhost:6379
