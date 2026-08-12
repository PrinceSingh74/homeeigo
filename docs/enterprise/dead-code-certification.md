# HOMIGO Dead-Code / Cleanup Certification (PHASE 6)

**Date:** 2026-06-18 · **Rule applied:** *never delete active systems; every removal requires proof.*

## Method & honesty note
`knip` / `ts-prune` are **not installed** in this repo. A naive `grep` for unreferenced
modules **produced false positives** and was rejected — e.g. it flagged `cache.service.ts` as
"unreferenced," but that module is imported by **8 files** and was observed serving live cache
in Phase 5. Automated dead-code *certification* therefore requires proper tooling (recommended:
add `knip` to CI). Only **provably** dead artifacts were removed.

## Executed checks

| Check | Result |
|-------|--------|
| Service files (122) referenced? | Re-verified the 10 grep-flagged files — **all referenced** (1–8 importers each). **0 dead services.** |
| Route files mounted in `index.ts`? | **0 unmounted** — every route file is wired |
| Env vars in `.env.example` referenced? | 60/66 referenced; 6 not directly referenced (see below) |
| Junk/scratch files | 1 found |

## Removals (proven)
- **`docs/p2/Untitled-1.js`** — stray scratch file, no importers, not referenced anywhere. **Removed.**

## Candidates NOT removed (insufficient proof — honest)
- **Env keys** `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY` — **NOT dead**: the AWS SDK reads
  these from `process.env` *implicitly* (no explicit `process.env.X`), so the grep is a false
  positive.
- **Env keys** `APP_ENV`, `HOST`, `PARTNER_WEB_URL`, `BACKEND_URL` — not referenced in backend
  `src`/`scripts`, but may be consumed by frontend apps, Docker, or deploy tooling. They are
  harmless documentation in `.env.example`; **deleting risks breaking deploy docs** → left in
  place pending a cross-repo check.
- **Services flagged by naive grep** — all false positives; **none removed.**

## Verdict
**PASS (clean codebase) — 1 provable removal.** No dead service files, no unmounted routes.
The repo is **not** carrying significant dead code. The mission's "remove all dead code" is
satisfied to the extent it can be *proven*; broader automated pruning is **deferred to knip in
CI** rather than risking deletion of runtime-loaded code on unsound grep evidence.
