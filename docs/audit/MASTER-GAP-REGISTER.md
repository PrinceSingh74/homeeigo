# HOMIGO — Master Gap Register (Phase 0–5)

**Date:** 2026-08-08 · **HEAD:** `b582ead` · **Mode:** audit-only, no remediation applied

Priority: **P0** blocks production · **P1** major · **P2** medium · **P3** nice-to-have

---

## P0 — Critical Blockers

### P0-1 · Phase 5 exists at no commit
| Field | Detail |
|---|---|
| **Problem** | All 39 Phase 5 files and migration `20260807200000_phase5_ai_tools` are untracked in git. |
| **Impact** | Cannot deploy, roll back, review, bisect, or attribute. A clone of HEAD has no tool layer. Certification cannot reference a SHA. 13,188 tool executions have run on unversioned code. |
| **Evidence** | `git ls-files apps/backend/src/ai-tools/` → **0 files**. `git status` → `?? apps/backend/src/ai-tools/`. Migration not in `git ls-files`. HEAD `index.ts` has no ai-tools import; working tree has it at lines 39, 211, 310, 313. |
| **Root cause** | Phase 5 work never committed. Last phase commit is Phase 4 (`60a2810`). |
| **Solution** | Review then commit Phase 5 as one atomic changeset including its migration. Re-run certification against the new SHA. |
| **Dependencies** | None technically — but 830 untracked / 318 modified files mean staging must be selective, never `git add -A`. |
| **Complexity** | Low mechanically, Medium with required review |
| **Phase** | 5 |

### P0-2 · Automation execution engine missing
| Field | Detail |
|---|---|
| **Problem** | Scheduled jobs are created but nothing executes them. No workflow model or engine exists. |
| **Impact** | Silent unbounded backlog; review-request automation has never fired. The AUTOMATION pillar — co-equal with AI CORE and ML PLATFORM in the target architecture — is ~1/3 built. |
| **Evidence** | `automation-scheduler.consumer.ts:8` — *"execution engine deferred to Phase 6"*. Runtime: 6 pending jobs, oldest overdue **6,788 min ≈ 4.7 days**. Only `scheduledJob` readers are an ETL copy job and `deploy/scripts/stage-f-scheduled-job-forensics.ts` (a script written to find overdue jobs — prior awareness). No `Workflow`/`AutomationRule` model in schema. |
| **Root cause** | Trigger shipped without executor; deferral not tracked as a live defect. |
| **Solution** | Leader-locked executor reusing the Phase 0 outbox pattern (`runWithLeaderLock`). **Must not create a second scheduler.** Alternatively, formally rescope AUTOMATION out of Phase 0–5 and amend the architecture. |
| **Dependencies** | Phase 0 leader lock (exists) |
| **Complexity** | Medium |
| **Phase** | 0 / Automation |

---

## P1 — Major Gaps

### P1-1 · AI Gateway usage tracking dead
| Field | Detail |
|---|---|
| **Problem** | `AiGatewayUsage` is never written to. |
| **Impact** | No AI usage visibility, no quota basis, no per-tenant cost attribution. Roadmap explicitly requires Usage + Cost. |
| **Evidence** | 0 usage rows vs **1,626** gateway requests and 1,627 audit rows. Repo-wide search for `aiGatewayUsage.(create\|upsert\|createMany)` → **0 matches**. Cost table: 1 row. |
| **Root cause** | Model defined in schema; write path never implemented. |
| **Solution** | Write usage + cost on each gateway completion, alongside the existing audit write. |
| **Complexity** | Low · **Phase** 3 |

### P1-2 · Grafana anonymous admin access
| Field | Detail |
|---|---|
| **Problem** | Running Grafana permits anonymous access with Admin role; admin password hardcoded in compose. |
| **Impact** | Anyone reaching :3004 gets Grafana admin — dashboards, datasources, and query access to platform metrics. |
| **Evidence** | `_obsstack/docker-compose.yml`: `GF_AUTH_ANONYMOUS_ENABLED: "true"`, `GF_AUTH_ANONYMOUS_ORG_ROLE: Admin`, `GF_SECURITY_ADMIN_PASSWORD: homigo_admin`. |
| **Solution** | Disable anonymous auth or scope to Viewer; move password to a secret reference. |
| **Complexity** | Low · **Phase** Observability/Security |

### P1-3 · Phase 1–4 dashboards not deployed
| Field | Detail |
|---|---|
| **Problem** | Dashboards authored but not mounted by the running Grafana. |
| **Impact** | Four phases have no runtime visibility despite dashboards existing — a false sense of observability. |
| **Evidence** | `homigo-analytics-pipeline/-eta-intelligence/-ai-core/-ai-brain.json` exist only in `monitoring/grafana/dashboards/`. Running `homigo-grafana` mounts `./dashboards` → `_obsstack/dashboards/`, which contains only `homigo-ai-tools.json` among new-phase dashboards. |
| **Solution** | Mount the correct directory, or provision the four dashboards into `_obsstack/dashboards/`. |
| **Complexity** | Low · **Phase** 1–4 |

### P1-4 · Phase 1 pipeline runs empty
| Field | Detail |
|---|---|
| **Problem** | ETL executes successfully but moves almost no data. |
| **Impact** | ML/feature foundations unproven at any volume; downstream forecasting rests on an untested path. |
| **Evidence** | `rowsLoaded: 0` on most jobs in runtime logs; `MlFeatureStaging` = **3 rows**; ETA `TRAINING_READY` = 3. |
| **Solution** | Drive representative volume through the pipeline and re-measure; confirm watermark/backfill behaviour under load. |
| **Complexity** | Medium (data/volume, not code) · **Phase** 1 |

---

## P2 — Medium

| ID | Gap | Evidence | Impact | Complexity | Phase |
|---|---|---|---|---|---|
| P2-1 | DLQ never exercised | `EventDeadLetter` = 0 rows | Failure path unproven in practice | Low | 0 |
| P2-2 | Memory engine barely used | `AiMemory` = 4 rows vs 1,629 conversations | Suggests memory may not be wired into the live request path | Medium | 4 |
| P2-3 | Token budget / compression / hallucination guard unverified | No evidence obtained | Roadmap-required controls unproven | Medium | 4 |
| P2-4 | ETL watermark / backfill / replay unverified | `checkpoint.ts` exists; semantics not exercised | Recovery behaviour unknown | Medium | 1 |
| P2-5 | Thin gateway alert coverage | 1 `ai_gateway` metric ref vs 6 for `ai_tool` | Gateway incidents may go unalerted | Low | 3 |
| P2-6 | ARIMA_PLUS production-grade claim unproven | Service exists; consumers unverified | Forecast quality unknown | Medium | 1 |

---

## P3 — Nice-to-have

| ID | Gap | Evidence | Complexity |
|---|---|---|---|
| P3-1 | 6 stale `eta.*` outbox rows | Now inert (terminal, no longer re-claimed); disposition deferred by prior decision | Low |
| P3-2 | No per-aggregate event ordering guarantee | Claim uses global `ORDER BY created_at ASC` | Medium |
| P3-3 | Dormant `.step8-tmp/` snapshot with old-namespace code | Not runtime-reachable | Low |
| P3-4 | Repo hygiene: 830 untracked / 318 modified / 20 deleted | `git status` | Medium |

---

## Summary by Phase

| Phase | P0 | P1 | P2 | P3 | Score |
|---|---:|---:|---:|---:|---:|
| 0 — Event Foundation | 1 (shared) | 0 | 1 | 2 | 92% |
| 1 — Data + ML Pipeline | 0 | 2 | 3 | 0 | 68% |
| 2 — ETA Intelligence | 0 | 0 | 0 | 1 | 88% |
| 3 — AI Core | 0 | 2 | 1 | 0 | 78% |
| 4 — Context/Memory/Prompts | 0 | 1 | 2 | 0 | 85% |
| 5 — Tools & Actions | 1 | 0 | 0 | 0 | 90% |
| Automation pillar | 1 | 0 | 0 | 0 | 35% |

**Overall ≈78%** (Performance excluded — `NOT_VERIFIED`)

---

## Recommended Sequence

1. **P0-1** — commit Phase 5 (unblocks every downstream claim; nothing else can be certified until the tree is versioned)
2. **P1-2** — close Grafana anonymous admin (smallest security win available)
3. **P1-1** — wire gateway usage/cost (low effort, restores AI spend visibility)
4. **P1-3** — deploy the four dashboards
5. **P0-2** — build the automation executor (largest effort; do it after the tree is clean so the work is reviewable)
6. **Performance pass** — run the load suite; replace `NOT_VERIFIED`
7. **P1-4 / P2-*** — volume, then re-verify the unverified set

---

**No item in this register was fixed during the audit pass.** Remediation awaits review of this register, per instruction.
