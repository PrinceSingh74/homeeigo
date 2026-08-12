# HOMIGO — Ultra-Deep Enterprise Certification Audit

**Date:** 2026-06-24 · **Standard:** trust-nothing. Assume broken until runtime evidence proves
otherwise. Every PASS below has a live probe / executed query; every finding is reproducible.
**No prior verdict was accepted on faith.**

---

## 1. Executive Summary

HOMIGO is a **fundamentally sound, well-engineered system** — its hardest invariants survived an
adversarial re-audit: **the financial ledger is perfectly balanced**, security held under fresh attacks,
the database is healthy, and Cloud Run autoscaling was proven on real infrastructure. But the skeptical
sweep **did surface real, previously-uncertified defects** — most notably an **unbounded 699 MB log table**
(flagged before, still unresolved), **2 circular dependencies** in the PII/encryption layer, and **12
minor data-integrity blemishes** in wallet snapshots / booking state. None are P0; none break production
or lose money or leak data. They are scaling, maintainability, and audit-trail risks.

**The prior "Finance = 100" and "Enterprise Elite" framings do not survive scrutiny** — the ledger is
100, but the wallet *audit trail* and one booking state are not. Honest grade below.

## 2. Real Score: **87 / 100**

## 3. Verdict: **CONDITIONAL — Production Ready** (not Enterprise Elite)
> 80–89 band. Safe to run for real customers; clear P1/P2 remediation required before "enterprise elite."

---

## 4. Findings (real, reproducible — not padded to an arbitrary 100)

> I will not fabricate 100 findings. Below are the issues I have **runtime evidence** for. A literal
> 100-item list would require exhaustive per-file static analysis — listed as the next step, not faked.

### P0 — Critical / blocking
**NONE FOUND.** No data loss, money loss, auth bypass, or production-breaking defect surfaced.

### P1 — High
| # | Finding | Evidence | Remediation |
|---|---------|----------|-------------|
| P1-1 | **`app_log_entries` = 699 MB** — application logs stored unbounded in Postgres; dominates DB size, **bloats backups → slows DR RTO**, wastes storage/cost. **Flagged in a prior audit, still unresolved.** | `pg_total_relation_size` = 699 MB (next table 276 MB) | Move logs to Loki/BigQuery or enforce retention (e.g., 14–30 d) + partition + `DELETE`/`pg_partman`; backup excludes it |

### P2 — Medium
| # | Finding | Evidence | Remediation |
|---|---------|----------|-------------|
| P2-1 | **`provider_match_scores` = 276 MB** — unbounded match-score accumulation | table size | TTL/retention + cleanup job (match scores are ephemeral) |
| P2-2 | **2 circular dependencies** in the PII/crypto layer: `prisma → prisma-pii-extension → encryption.service → {enterprise-audit, key-management}` → back to prisma | `madge --circular` (318 files, 2 cycles) | break the cycle (lazy import / extract an interface / inject the client) — init-order fragility risk for the encryption layer |
| P2-3 | **11 `wallet_transactions` with wrong `balance_after` snapshot** (e.g., before=0, +500 CREDIT, after=0 — snapshot not updated) — audit-trail inconsistency | SQL: 11 CREDIT rows where `after ≠ before+amount` (DEBIT rows OK) | verify seed-vs-runtime; if runtime, fix the snapshot write to be atomic with the balance update |

### P3 — Low
| # | Finding | Evidence | Remediation |
|---|---------|----------|-------------|
| P3-1 | **1 booking `COMPLETED` with `completed_at = NULL`** — impossible state (id `cmq6ukek…`, created 2026-06-09) | SQL count = 1 | backfill the timestamp; add a CHECK/trigger so COMPLETED requires `completed_at` |
| P3-2 | **`booking_created_total` counter = 0** vs 179 DB bookings — it's a since-process-start counter; **misleading if a dashboard treats it as a total** | metric 0 vs DB 179 | dashboards must use the DB-computed `biz_*` gauges for totals, not `_total` counters |
| P3-3 | `services` query is a **seq scan** (fine at 28 rows, optimal) — but **add `idx(is_active, created_at)` before the catalog grows** | `EXPLAIN ANALYZE` Seq Scan, 0.58 ms | preemptive index |

---

## 5–14. Risk register (what survived scrutiny vs what didn't)

### Financial Risks — **mostly PASS, not 100**
- ✅ **Double-entry ledger balanced**: `sum(debit_paise)=sum(credit_paise)=29,051,570`, **0 unbalanced journals**.
- ✅ **0 negative balances**, **0 double-success-payments/booking**, **0 duplicate refunds**, **0 refunds
  exceeding payment**, **0 unresolved settlement discrepancies**, hcoin `balance = earned − redeemed` exact.
- ⚠️ wallet-snapshot blemishes (P2-3) + 1 impossible booking (P3-1). **Finance ≈ 95, not 100.**

### Security Risks — **PASS under re-attack**
- ✅ SQLi **neutralized** (`'; DROP TABLE bookings; --` → table still 179 rows; Prisma parameterizes).
- ✅ **IDOR** (other user's booking) → **404** (no leak). ✅ **Privilege escalation** (customer→admin) → **403**.
- ✅ **alg=none JWT forge → 401**. ✅ Webhook unsigned/bogus-sig → 401 (prior phase). Role unchanged after
  mass-assign attempt (endpoint returned 404 — mass-assignment not exhaustively reachable; low residual).

### Architecture Risks
- ⚠️ 2 circular deps (P2-2). 318 backend modules, 14 madge warnings. Otherwise clean module boundaries.

### Reliability Risks — **PASS (recent real evidence)**
- ✅ DR: real backup→restore **RTO 32 s / RPO 0**. ✅ Memory: **leak-free** (flat heap floor under load soak).
  ✅ DB live: 0 locks, 0 long-running, healthy vacuum, **no bloat**. ⚠️ backend OOM-crashes on this
  **memory-pressured dev box** (external; not a backend leak — proven separately).

### Future Scale Risks — **CONDITIONAL (recent real evidence)**
- ✅ **Cloud Run autoscaling PROVEN on real GCP** (Phase 8): multi-instance, p95 64 ms; **found+fixed a real
  Cloud-SQL connection-exhaustion bug** (`connection_limit`). ⚠️ single Bun node ceiling ≈ **668 req/s**
  (CPU/event-loop bound, not DB) → needs horizontal scaling + pgbouncer; <0.1% error at 1k–10k VU needs the
  production-sized config. ⚠️ The 699 MB log table is also a scale/cost drag.

### Observability — **PASS**
- ✅ **154 metric families**; `biz_*` KPIs are **DB-computed gauges** (GMV ₹23,293, active customers 172),
  `db_connections_active=2` matches reality. ⚠️ counter-vs-total caveat (P3-2).

---

## 15. Remediation plan (ordered)
1. **P1-1** — log retention/offload for `app_log_entries` (biggest single win: DB size, backup/RTO, cost).
2. **P2-1** — retention for `provider_match_scores`.
3. **P2-2** — break the 2 PII-layer circular dependencies.
4. **P2-3 / P3-1** — reconcile wallet snapshots + the 1 impossible booking; add CHECK/trigger invariants.
5. **Scale** — pgbouncer + `connection_limit` sizing + concurrency 8–16 + warm min-instances (Phase-8 findings).
6. **P3-2/P3-3** — dashboards use gauges; preemptive `services` index.

---

## Scope honesty
**Deep-audited live this session:** finance/ledger (Phase 7/15), security re-attacks (Phase 6), DB
queries/plans/bloat/sizes (Phase 5), architecture circular deps (Phase 1), observability/data-drift
(Phase 8/14). **Carried forward from recent REAL runs (re-examined skeptically, not blindly trusted):**
Cloud Run autoscaling (Phase 11/9 — real deploy), memory soak (Phase 12), perf/UX (Phase 2/3/13), DR
(Phase 10). **Not re-runnable here:** literal 100k load + 24 h soak (need a deployed cluster) — these
remain BLOCKED, not PASS. The 87 reflects proven-good core minus the real findings above — **not upgraded
because reports existed.**
