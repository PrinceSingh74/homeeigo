# Production Build Certification

**Audit timestamp:** 2026-06-14T20:44:00Z  
**Method:** `next build` / `bun build` on clean or near-clean `.next` directories

---

## apps/web (Customer)

| Check | Result | Evidence |
|-------|--------|----------|
| TypeScript | **PASS** | Build completed, `measurements/web-build.log` |
| Build | **PASS** | 30/30 static pages generated |
| Warnings | **PASS** (0) | No ESLint warnings in log |
| Homepage First Load JS | **195 kB** (after) vs **205 kB** (before) | `web-build.log` route table |
| Profile First Load JS | **203 kB** (after) vs **231 kB** (before) | same |

**Target check:**
- Homepage <120 kB: **FAIL** (195 kB measured)
- Profile <150 kB: **FAIL** (203 kB measured)

---

## apps/admin-panel

| Check | Result | Evidence |
|-------|--------|----------|
| TypeScript | **PASS** | Build completed |
| Build | **PASS** | 52/52 pages, `measurements/admin-build.log` |
| Warnings | **FAIL** (4) | `StatusBadge` unused ×2, `setRefundAmount` unused, `useMemo` deps |
| Overview First Load JS | **134 kB** | build log |

---

## apps/partner-web

| Check | Result | Evidence |
|-------|--------|----------|
| TypeScript | **PASS** | Build completed |
| Build | **PASS** | 24/24 pages, `measurements/partner-build.log` |
| Warnings | **PASS** (0) | Clean lint pass |
| Analytics First Load JS | **246 kB** | build log (recharts) |

---

## apps/backend

| Check | Result | Evidence |
|-------|--------|----------|
| TypeScript bundle | **PASS** | `bun build src/index.ts --outdir dist` → 17.42 MB |
| Runtime start | **PASS** | Server listening `:3000` at 2026-06-14T20:42:01Z |

---

## Clean Build Protocol

```powershell
Remove-Item -Recurse -Force apps/web/.next    # partial clean attempted
Remove-Item -Recurse -Force apps/admin-panel/.next
Remove-Item -Recurse -Force apps/partner-web/.next
npm run build --prefix apps/web
npm run build --prefix apps/admin-panel
npm run build --prefix apps/partner-web
cd apps/backend && bun run build
```

---

## Verdict

| App | Build | TS | Zero Warnings | Bundle Targets |
|-----|-------|----|--------------:|----------------|
| web | PASS | PASS | PASS | **FAIL** |
| admin-panel | PASS | PASS | **FAIL** (4) | N/A |
| partner-web | PASS | PASS | PASS | N/A |
| backend | PASS | PASS | PASS | N/A |

**Overall production build certification: PARTIAL PASS**
