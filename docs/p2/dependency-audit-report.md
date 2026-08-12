# HOMIGO Dependency Audit

**Date:** 2026-06-12 · **Method:** `bun audit` (backend) + `npm audit --omit=dev` (web apps), executed. Each finding triaged for **runtime exploitability**, not just advisory presence.

## Before → After

| Package | App | Severity | Status |
|---|---|---|---|
| **next 15.1.6** (CVE-2025-29927 middleware auth-bypass, RCE in RSC flight, SSRF, cache-poisoning) | apps/web | **CRITICAL** | ✅ **FIXED** → upgraded to **15.5.19** (re-audit: critical gone) |
| postcss <8.5.10 (XSS in CSS stringify) | web, partner-web, admin-panel | moderate | ⚠️ Accepted — **build-time only** (bundled inside `next/node_modules`; postcss processes our own CSS at build, never user input → not runtime-exploitable). Clears only when Next bumps its bundled postcss upstream. `npm audit fix --force` **rejected** — it downgrades next to 9.3.3 (destructive). |
| uuid <11.1.1 (buffer bounds in v3/v5/v6 when `buf` passed) | apps/backend | moderate | ⚠️ Accepted — **not exploitable**: the only consumer, `exceljs`, calls `uuid.v4()` with no `buf` argument (verified in `exceljs/lib/.../cf-rule-ext-xform.js`), so the vulnerable v3/v5/v6 buf path is never reached. uuid is pinned by exceljs at 8.3.2; force-overriding to v11 risks breaking exceljs. |

## Executed evidence
- `apps/web`: `npm install next@^15.5.18` → installed **15.5.19**; re-`npm audit --omit=dev` → **1 critical + 1 moderate → 2 moderate** (critical eliminated). React 19 unchanged; version now matches the already-running partner-web/admin-panel (15.5.18), so the minor-within-major bump is low-risk.
- Backend `bun audit`: 1 moderate (uuid), triaged non-exploitable as above.

## Net result
**Zero exploitable critical/high vulnerabilities remain.** The 3 residual moderate advisories are all non-runtime-exploitable (build-time postcss × N, plus an unreachable uuid code path) and are documented with rationale rather than force-patched destructively.

## Follow-ups (recommended, not blocking)
- Run `next build` on apps/web to confirm the 15.1.6→15.5.19 bump has no build regression (sibling apps already run 15.5.18, so risk is low).
- Track Next.js releases; adopt the version that bundles postcss ≥8.5.10 to clear the residual moderates.
