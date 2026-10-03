# PHASE 15 - Final Release Status

# `RELEASE_BLOCKED_AUTHORIZATION`

Then, in order: `RELEASE_BLOCKED_RUNTIME`, then `RELEASE_BLOCKED_DATA_RECONCILIATION`.

Not `RELEASE_READY` - that would claim the remaining work is only execution, and one of the three
blockers is a finance decision nobody has made yet.

---

## A. Why this status and not another

| Candidate | Why not |
|---|---|
| `RELEASE_READY` | Two of three blockers are decisions, not steps. Feature flags do not exist in production and the fixture-data question is unanswered |
| `CANARY_ACTIVE` | No runtime, no cohort, no flags to canary behind |
| `PRODUCTION_LIVE` | No process listens on any port. Nothing to be live |
| `PRODUCTION_LIVE_WITH_FOLLOWUPS` | Same |
| `RELEASE_BLOCKED_RUNTIME` | True, but authorization blocks earlier - deploying a runtime is itself a production action |
| `RELEASE_BLOCKED_DATA_RECONCILIATION` | True, and it blocks trusting production figures, but not the deployment itself |

Authorization is named first because it gates every other action.

## B. The three boundaries, precisely

**1. Authorization.** No env var, no file, no codebase convention, no `production` GitHub
environment. The only deploy workflow declares in its own header: *"Does NOT deploy production."*
There is no production deployment path in this repository.

**2. Runtime.** Zero application ports listening. Artifacts are ready and boot-verified against a
migrated clone. One deployable unit - HTTP, scheduler, events and workflow engine are the same
process.

**3. Data reconciliation.** 231 fixture bookings (34% of all bookings), 110 payments (Rs.58,333),
and 14 CREDITED earnings (Rs.6,286.40) that have already moved provider wallet balances - two wallets
are 100% fixture. No money has left the platform (0 COMPLETED withdrawals, directly verified), but
the correction requires a finance decision.

## C. What is genuinely finished

| | Evidence |
|---|---|
| Migration set rehearsed | 12 migrations, exit 0, 28.3 s and 40.6 s across two clone runs, zero audit-row loss |
| Schema reconciled at object level | +9 tables, +163 columns, 0 removed, exactly 1 index dropped (the intended one) |
| Audit fix proven at runtime | 4-event governance chain persisted on one trace, on the migrated clone |
| Production audit defect proven | max 1 event per trace across 353,220 rows |
| Backup and restore verified | fresh 52 MB dump, SHA256 + archive integrity, restore RTO **25.64 s** |
| ML registry shape verified | full lifecycle enum plus `beats_baseline`, `approved_by`, rollback fields |
| AI budget shape verified | reserve/settle plus an explicit `unknown_cost_requests` column |
| **Feature-flag gating built** | was **absent** for every Phase-15 capability; now two fail-closed flags with three tests |
| Audit-loss defect fixed | system actors no longer discard audit rows; runtime test |
| Regression | 2001 pass, 0 deadlocks, 1 batch-order flake that passes in isolation |

## D. Blockers that are correct, not failures

These stay blocked on evidence, and forcing them would be the failure:

- **Voice** - no STT/TTS adapter exists.
- **Multimodal conversational** - no injection-defence design, no policy on what image content may
  influence. Vision stays one-way.
- **Cancellation model** - 0.24 SE over baseline. Not promoted.
- **Provider-acceptance model** - the deterministic baseline **beats** it. Baseline is used, and
  calling it ML would be a lie.
- **Fraud ML** - 9 adjudicated labels is not a training set.
- **Recommendation** - 117 of 147 customers have booked once. Personalisation has nothing to
  personalise on.

## E. Stop condition

All safe preparation is complete. Continuing would mean inventing engineering tasks, which the brief
forbids and which would not move any of the three boundaries.

**Execution resumes when authorization, a runtime and the reconciliation decision exist.** At that
point the rehearsed path in `PHASE_15_PRODUCTION_RELEASE_HANDOFF.md` section I runs, and every
production check re-runs from zero against the deployed system.

## F. Production, after this pass

```
applied migrations : 97      (unchanged)
public tables      : 203     (unchanged)
bookings           : 670     (unchanged)
audit rows         : 353,220 (unchanged)
feature flags      : 2       (unchanged)
```

**No production mutation was performed.** One read-only backup was taken - `pg_dump` does not modify
the source - and one clone was created and dropped.
