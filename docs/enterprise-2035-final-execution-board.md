# HOMEEIGO — Final Execution Board

**As of 2026-09-21, after two remediation passes.**

Status vocabulary: `RUNTIME_VERIFIED` · `TEST_VERIFIED` · `FIXED` · `WIRED` · `DISCONNECTED` · `BROKEN` · `EXTERNAL_BLOCKED` · `BUSINESS_DECISION` · `OPERATOR_ACTION` · `ENVIRONMENTAL` · `WITHDRAWN`

---

## A. ENTERPRISE TECHNICAL COMPLETION = **NOT ACHIEVED**

Two P1 engineering items remain technically actionable; the rest are external, owner or operator dependencies. Exact blockers in §E.

---

## B. Closed this session

| Pri | ID | Item | Root cause | Fix | Test | Runtime | Status |
|---|---|---|---|---|---|---|---|
| P1 | MIG-1 | 4 unique indexes on plaintext PII survive into any fresh deploy | `ALTER TABLE ... DROP CONSTRAINT IF EXISTS` cannot drop a `CREATE UNIQUE INDEX`; `IF EXISTS` silenced it | `20260921090000_schema_drift_repair` | migration-authority 29/29 | rebuild + live both PASS | **FIXED** |
| P1 | MIG-2 | 15 indexes existed only via `db push`, incl. the **duplicate-booking guard** | `booking_unique_active_slot` never in any migration | same migration | 29/29 | PASS | **FIXED** |
| P2 | MIG-3 | Live missing 3 perf indexes from an applied migration | db-push era loss | same migration (`IF NOT EXISTS`) | 29/29 | PASS | **FIXED** |
| P1 | FIN-1 | 56 plugs (−₹17,245) forced commingled `PLATFORM_ESCROW` to equal gift-card balance | Non-invariant comparison in `ADJUSTABLE` | Escrow removed from `ADJUSTABLE`; row informational; `maxDelta` scoped | 4 assertions, **proven to fail on regression** | — | **FIXED** |
| P1 | FIN-3 | ₹32 wallet residual | **Two offsetting errors**: +₹1,362 journals over transactions, −₹1,394 plugs under seeds | Attributed to the rupee; **not plugged** | orphan + duplicate detectors | ✅ both detect | **ROOT-CAUSED** |
| P1 | FIN-4 | ₹552 double-credit: 4 H-Coin redemptions journaled twice | A second `recordWalletTopUpInTransaction` on a redemption | Code already fixed; **regression guard added** | 5 assertions, **proven to fail on regression** | data confirms fix landed 09-15→09-19 | **GUARDED** |
| P2 | REF-1 | 0 of 53 `INDETERMINATE` refunds visible; tile read 100 vs 303 | Oldest-first 100-row page consumed by June `FAILED` | Urgent-first ordering; authoritative counts | 5 assertions | 53/53 now visible | **FIXED** |
| P1 | SEC-9 | `AI_RATE_LIMIT_BYPASS`, `AI_TOOL_CERTIFICATION_MODE` had **no environment condition** | Read raw from env | 10 bypass flags refused in staging **and** production | 8 assertions | — | **FIXED** |
| P2 | SEC-10 | `localhost:3001-3003` in the deployed CORS allowlist with `credentials: true` | Unconditional membership | Gated on `isDev` | — | — | **FIXED** |
| P2 | SEC-11 | `hashForLookup` peppered provider PAN/Aadhaar with literal `"homigo"` | Lazy fallback, no production guard | Fails closed; hash unchanged (no rehash) | PII suite 15/15 | — | **FIXED** |
| P1 | WFR-1 | Recovery required `observedUpdatedAt`; detection never returned it | Contract gap — **no UI could have been built** | `updatedAt` added to `StuckInstance` | 6 assertions | 8 stuck, 0 missing field | **FIXED** |
| P1 | OPS-1a | 16 stuck workflows detected, unactionable | No operator surface | Stuck-instance panel with evidence + `actionable` gating | contract test | — | **WIRED** |
| P1 | ETL-1 | `homigo_etl_jobs_running` read **111** on a pipeline dead a month | No age condition — all 111 crashed | Split `running` / `abandoned` / `recovering_24h` | — | verified vs DB: 0 / 111 / 6 | **FIXED** |
| P1 | DBH-1 | ~399 MB of a 1,060 MB DB is unreclaimed space | Proportional autovacuum vs repeatedly-emptied tables | `20260921100000_autovacuum_high_churn_tables` (8 tables) | — | clone verified | **FIXED (recurrence)** |
| P1 | AI-1 | Dry-runs billed as real spend — $0.0143 with **no credential configured** | Mock indistinguishable from a completion | `mocked` flag; actual cost 0; estimate on its own series | 6 assertions | — | **FIXED** |
| P1 | **OBS-1** | **84 of 111 alerts defined but NOT LOADED**, incl. every money alert | Stack mounted a **2026-07-04** snapshot | Mount repointed to canonical; staging synced | promtool 111 SUCCESS | **`/api/v1/rules` = 27** | **FIXED** (needs recreate) |
| P2 | OBS-2 | New metrics had no alerts | — | 3 rules added, canonical + staging | promtool | — | **FIXED** |
| P2 | UNW-1 | Fraud console could freeze a commission but not unfreeze | Endpoint existed with no caller | `unfreezeCommission` + status-aware button | — | RBAC rule pre-existed | **WIRED** |

---

## C. Audit findings WITHDRAWN after re-measurement

Ten. Each was corrected only by re-measuring, never by assertion.

| Finding | Claimed | Verified reality |
|---|---|---|
| **DB-4 / BLOCKER-1** | Migration history unrebuildable — **P0** | 3 are benign Prisma retries; fresh DB applies all 125 and passes 29/29 |
| **DB-6** | ₹52,939 drift / 24 users / no invariant | **₹32**; invariant exists and **was failing continuously** |
| **DB-7** | 53 refunds stranded by a gating bug | Deliberate documented fail-safe; artifacts are ₹1 `f2 cert` rows |
| **DB-2** | Autovacuum never ran | Autovacuum **on**; statistics were lost |
| **DB-3 / SEC-7** | Audit tables have no retention | `enterprise_audit_logs` **is** covered |
| **DB-1 (`otps`)** | Heap bloat | **Index** bloat — needs `REINDEX` |
| **SEC-2** | `ALLOWED_ORIGINS` is the sole CORS input | Merged with defaults; replaced by the real SEC-10 |
| **SEC-5** | `PII_MASTER_KEY` absent | Wrong variable; `MASTER_ENCRYPTION_KEY` is set and fails closed |
| **SEC-3** | Dev bypasses active in deployment | Load-test + payment mocks already guarded; two AI bypasses were not |
| **OPS-1b** | "Detection without remediation" across settlements/fraud | **Overstated** — both consoles have working remediation; one asymmetry (`unfreeze`), now closed |

Measurement errors made and corrected **within** this work: a heredoc stripping `\b` into a backspace; `grep -E` treating `\|` as literal (reported `ledger: 0 alerts`, actually 8); summing H-Coin **coins** as rupees (fabricated ₹3,670); an auth heuristic missing router-level `.use(authPlugin)` (falsely suggested unauthenticated endpoints — disproved by runtime probes).

---

## D. Open — technically actionable (the only two)

| Pri | Item | Why it is still open | Next action |
|---|---|---|---|
| **P1** | **Compliance: consent withdrawal + DSR status unreachable** | Backend complete; **no client consumer**. DPDP/GDPR require both. The one customer-facing gap that is a legal requirement, not a product preference | Wire `POST /api/compliance/consent/withdraw` and `GET /api/compliance/request/*` into the customer app |
| **P1** | **DQ-2: no provenance column on any business table** | 97 % of refunds are synthetic and **nothing marks them**; classification survives only as free text. No analytic can exclude them | Additive `data_origin` column + backfill from existing markers (§3 of `data-quality.md`) — schema is small, the retention policy is the owner's |

---

## E. Blocked — not engineering

| Class | Item | Unlock |
|---|---|---|
| `OPERATOR_ACTION` | Apply the 2 migrations to `homigo_db` | `prisma migrate deploy` — **+6 indexes, no drops, no data change** |
| `OPERATOR_ACTION` | Recreate Prometheus to load 111 alerts | `docker compose up -d prometheus` in `_obsstack` |
| `OPERATOR_ACTION` | Reclaim ~399 MB (`VACUUM FULL` / `REINDEX`) | Maintenance window (ACCESS EXCLUSIVE) |
| `BUSINESS_DECISION` | Reverse 56 escrow plugs (−₹17,245) | Finance sign-off on a correcting entry |
| `BUSINESS_DECISION` | Resolve the ₹32 (now fully attributed) | Reverse the orphan + duplicates, or accept with a stated reason |
| `BUSINESS_DECISION` | `assignment_audits` retention (173k rows) | Sets how far back a disputed dispatch is reconstructable |
| `BUSINESS_DECISION` | Reaper for 111 abandoned ETL rows | Writes to `homigo_db` |
| `BUSINESS_DECISION` | ETL: restore vs retire | **Do not build a second ETL** |
| `BUSINESS_DECISION` | Customer/partner intelligence surfacing | Product decision on placement |
| `BUSINESS_DECISION` | Partner self-pause | Dispatch policy while offers are in flight |
| `EXTERNAL_BLOCKED` | BigQuery billing | Enable billing + `GCP_PROJECT_ID` / `BQ_DATASET` |
| `EXTERNAL_BLOCKED` | AI inference | One provider key — **after** a budget cap and a verified PII scrub |
| `EXTERNAL_BLOCKED` | Email (Resend), S3, Expo OTA, production Sentry | Credentials |
| `EXTERNAL_BLOCKED` | Mobile device certification | Physical devices |
| **`ENVIRONMENTAL`** | **C: 1.83 GB free (0.6 %)** | See §F — **this is the most urgent non-engineering item** |

---

## F. ENVIRONMENTAL — C: drive at 0.6 % free

The documented failure chain is `C: → 0 bytes` → log failure → Docker failure → **PostgreSQL interruption**. `%LOCALAPPDATA%\Temp\wsl-crashes` holds **446 MB**, which is itself evidence this has been happening.

Safely reclaimable, **none of it touched** (all user-owned):

| Item | Size | Safe to delete |
|---|---|---|
| `%LOCALAPPDATA%\Temp\DockerDesktopUpdates` | 599 MB | yes — downloaded installers |
| `%LOCALAPPDATA%\Temp\wsl-crashes` | 446 MB | yes — crash dumps |
| vscode installer temp dirs (×3) | 629 MB | yes |
| `%LOCALAPPDATA%\Temp\DiagOutputDir` | 240 MB | yes |
| `%LOCALAPPDATA%\Temp` (remainder) | ~0.8 GB | mostly yes |
| `%LOCALAPPDATA%\npm-cache` | 1.22 GB | yes — regenerable |
| `%USERPROFILE%\.bun\install\cache` | 1.01 GB | yes — regenerable |
| Leftover certification databases (13) | **3.5 GB** | **inside the Docker VHDX** — `homigo_dr_cert` alone is 1,280 MB, larger than `homigo_db`. May hold DR evidence — **review before dropping** |

**Done this session:** Docker build cache pruned (3.59 GB reclaimed inside the VHDX, preventing it growing into the last of C:); my own verification clones dropped; disposable output moved to `D:/homigo-ci-tmp` as instructed.

**The full backend suite was started and then deliberately stopped** when C: fell from 3.44 GB to 1.84 GB mid-run. Protecting the environment outranked collecting the evidence. A targeted 12-suite regression was run instead: **236 pass / 0 fail**.

---

## G. Verification totals

| Gate | Result |
|---|---|
| Typecheck — backend, admin, web, partner-web | **4/4 exit 0** |
| Targeted regression (12 suites) | **236 pass / 0 fail** |
| Full backend suite (2,633 baseline) | **NOT RUN — stopped for disk safety.** Baseline unverified this pass |
| `verify-migration-authority` — live **and** migrations-only rebuild | **29/29 PASS** both |
| `promtool check rules` | **111 rules SUCCESS** (canonical), 86 (staging) |
| `check-log-governance` / `check-migration-safety` / `check-ddl-guard-coverage` | **PASS** |
| Live backend after all changes | `/health` 200 · `/ready` 200 · admin 401 · `/api/services` 200 |
| Data mutated | **none** — bookings 705, payments 419, ledger_entries 2,295, journals 975, refunds 339 unchanged |

Three repository gates fired against this work and **all three were satisfied by fixing the code, never by overriding the gate**: migration-safety refused a destructive draft; the DDL guard caught a hardcoded database name; `tsc` caught the tool-loop branch that would have kept billing dry-runs as real spend.

Two new tests were **proven to fail when their defect is reintroduced** (ledger scope, H-Coin double-journal), then restored.

---

## H. Honest limits

- **The 2,633/0 baseline was not re-verified.** The run was stopped for disk safety.
- **No production evidence exists** — there is no production runtime.
- **Business volumes are contaminated** (97 % of refunds are synthetic); no figure here describes the business.
- **Mobile is unverified** — requires physical devices.
- **Alert delivery to a human is unproven**, and now that 111 alerts will load, delivery matters more than before.
- **The unwired count (92)** is a matcher aggregate with verified errors in both directions; individual rows are leads, not facts.
