# Branding Migration — Pre-Change Audit (`Homigo` → `Homeeigo`)

**Date:** 2026-07-06
**Rule (approved):** Case-preserving — `HOMIGO`→`HOMEEIGO`, `Homigo`→`Homeeigo`, display-only `homigo`→`homeeigo`.
**Principle:** Change **user-visible branding only**. Every internal identifier stays byte-for-byte unchanged.

---

## Occurrence totals (case-insensitive, excluding `node_modules`/`.next`/`dist`/locks)

| App | Files containing `homigo` |
|---|---|
| apps/web (customer) | 106 |
| apps/admin-panel | 32 |
| apps/partner-web | 18 |
| apps/backend | 52 |
| homigo-mobile | 64 |

Raw text-pattern counts: `Homigo` (title) ≈ 22 lines · `HOMIGO` (caps, excl. `HOMIGO_`) ≈ 357 lines.
**The vast majority are NOT branding** — they are internal identifiers (see UNSAFE below). Only genuine display strings are in scope.

---

## ❌ UNSAFE — never modified (internal identifiers)

| Pattern | Example | Why |
|---|---|---|
| `HOMIGO_*` window/env globals | `HOMIGO_NAV_METRICS__`, `HOMIGO_MAP_DOM__` | telemetry/env globals |
| `homigo_*` metrics | `homigo_access`, `homigo_refresh`, `homigo_mobile_startup_*` | Prometheus metric names |
| `homigo:` redis keys | `homigo:presence:*` | Redis key prefixes |
| package names | `homigo-web`, `homigo-backend`, `homigo-partner-web`, `homigo-admin-panel`, `homigo-mobile` | npm/workspace identity |
| infra names | `homigo-postgres`, `homigo-redis`, `homigo-prod-backups`, `homigo_db` | Docker/DB/S3 |
| domains / seed emails | `homigo.app`, `homigo.com`, `@homigo.demo` | URLs + test fixtures (login creds) |
| Sentry release | `homigo-backend@1.0.0` | release channel |
| **code identifiers** | `WhyHomigoSection`, component/file/type names containing `Homigo` | renaming breaks imports |
| backend startup ASCII banner (`index.ts`) | `🚀 HOMIGO BACKEND RUNNING` | dev-only console log, internal |
| API routes, WS channels, queue names, Prisma models, env var names | — | infrastructure contract |

---

## ✅ SAFE — in scope (user-visible surfaces)

### Customer web (`apps/web`)
- `src/app/layout.tsx` — metadata `title` template, `description`, OpenGraph/Twitter title+desc, `applicationName`, JSON-LD `name`, `authors`
- `src/app/(with-bottom-nav)/(aurora-nav)/page.tsx` — home metadata + `ORGANIZATION_JSONLD.name`
- Route metadata: `membership/layout.tsx`, `referrals/page.tsx`, `ai/page.tsx`, `services/page.tsx`
- Legal pages (user-facing): `legal/privacy`, `legal/cookies`, `legal/terms`, `legal/refund`
- `components/Navbar.tsx` — `aria-label="HOMIGO home"` (logo text already `homeeigo`)
- `components/layout/SiteFooter.tsx` + any footer/brand text
- Marketing/service sections with visible `HOMIGO`/`Homigo` copy
- PWA manifest (if present) / theme metadata

### Admin panel (`apps/admin-panel`)
- `src/app/layout.tsx` — metadata title/description
- Sidebar / shell brand text ("HOMIGO ENTERPRISE OS")
- Login page brand

### Partner web (`apps/partner-web`)
- `src/app/layout.tsx` — metadata
- `components/layout/PartnerSidebar.tsx` — `HOMIGO` / `PARTNER` brand (lines ~130-133)
- `components/settings/SettingsCenter.tsx`, login/onboarding brand

### Backend — user-facing text ONLY (`apps/backend/src/services`)
- `email.service.ts`, `email-delivery.service.ts` — email subjects/bodies, "Homigo Team" signature
- `invoice.service.ts`, `invoice-report.service.ts`, `chargeback-evidence-pdf.service.ts`, `lib/pdf-branding.ts` — visible PDF branding
- Notification copy (push/in-app) with visible brand
- **NOT** touched: log banner, metric labels, sentry release

### Mobile (`homigo-mobile`)
- `app.json` — `name` / display name / splash (slug stays internal)
- `src/components/auth/LoginForm.tsx`, home/header screens, `src/constants/servicesData.ts` visible copy
- SEO/meta

---

## Verification plan (post-change)
1. `tsc --noEmit` on web + admin + partner (0 errors)
2. Confirm zero changes to: package names, env vars, metric names, redis keys, API routes, WS channels, Prisma models, domains, seed emails
3. Grep residual internal `homigo` = unchanged count; display `HOMIGO`/`Homigo` = migrated
4. Report → `branding-migration-report.md`
