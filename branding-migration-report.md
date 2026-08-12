# Branding Migration Report — `Homigo` → `Homeeigo`

**Date:** 2026-07-06
**Rule:** Case-preserving — `HOMIGO`→`HOMEEIGO`, `Homigo`→`Homeeigo` (user-visible only).
**Scope:** All customer / partner / admin / SEO / email / PDF / notification / mobile branding. **Zero** backend-integration / DB / env / API / infra changes.

---

## Files migrated (contain the new `HOMEEIGO`/`Homeeigo` brand)

| App | Files migrated |
|---|---|
| apps/web (customer) | 87 |
| homigo-mobile | 47 |
| apps/backend (user-facing only) | 19 |
| apps/partner-web | 13 |
| apps/admin-panel | 12 |
| **Total** | **178** |

Brand tokens now present: **369× `HOMEEIGO`** + **4× `Homeeigo`**.

---

## What changed (user-visible surfaces)

### Customer web
- Root metadata: `title` default + template, `description`, `applicationName`, `authors`, OpenGraph + Twitter title/desc, `siteName`
- Home + route metadata (membership / referrals / ai / services) + `ORGANIZATION_JSONLD.name`
- Legal pages (privacy / cookies / terms / refund)
- Navbar `aria-label`, `SiteFooter` brand + copyright, hero/marketing/AI/auth component copy, error/loading/not-found screens
- (Logo wordmark was already `homeeigo`.)

### Admin panel
- Sidebar wordmark `HOMIGO` → `HOMEEIGO`, layout metadata title (`HOMEEIGO Business HQ — Admin`), error-boundary copy

### Partner web
- `PartnerSidebar` wordmark (`PARTNER` kept), layout metadata (`HOMEEIGO Partner`, `HOMEEIGO Pro`), Settings copy, error-boundary copy

### Backend — user-facing text ONLY
- **Emails:** password reset, email verification, welcome, booking confirmation/assigned, payment, partner-registration OTP (subjects + bodies + "HOMEEIGO" sender display name)
- **SMS/notifications:** OTP verification code, gift-card notification, wallet-credit notifications
- **PDFs:** invoice header + footer, earning invoice, chargeback evidence pack, executive finance report, `pdf-branding.ts` brand/legal name
- **In-app text:** wallet refund notes, support error copy, referral/transfer display-name fallback (`HOMEEIGO user`), customer-AI reply copy

### Mobile
- `app.json` **display name** `HOMIGO` → `HOMEEIGO`
- Login/home/header screens, welcome toast, device label (`Homeeigo Mobile`), services copy

---

## ✅ Preserved unchanged (verified) — every internal identifier

| Category | Verified value(s) |
|---|---|
| Package names | `homigo-web`, `homigo-backend`, `homigo-partner-web`, `homigo-admin-panel`, `homigo-mobile` |
| Env / window globals | 15× `HOMIGO_*` intact · **0 `HOMEEIGO_` leaked** |
| Prometheus metrics | `homigo_access`, `homigo_analytics`, `homigo_mobile_*`, … unchanged |
| Booking-number format | `HOMIGO-YYYYMMDD-…` + `/^HOMIGO-/` regex unchanged |
| Sentry release | `homigo-backend@1.0.0` unchanged |
| Backend startup banner | `HOMIGO Backend Running` unchanged (internal log) |
| Mobile deep-link | `scheme: "homigo"`, `slug: "homigo-mobile"` unchanged |
| Domains / emails | `homigo.app`, `homigo.com`, `homigo.in`, `@homigo.demo` unchanged |
| localStorage keys | `homigo-theme`, `homigo-auth`, `homigo-nav`, … unchanged |
| Code identifiers | `WhyHomigoSection`, `HOMIGO_RIDER_IMAGE`, component/type names unchanged |
| Credential hint | `Homigo@123` (demo password) unchanged |
| AI system prompt | internal LLM instruction unchanged |
| API routes · WS channels · queue names · Prisma models · DB tables | untouched |

**Technique:** case-preserving replace with negative lookahead `HOMIGO(?![-_])` — automatically protected every `HOMIGO_` global and `HOMIGO-` booking prefix. Comments/banner/dev-logs/AI-prompt excluded by scope.

---

## Verification results

| Check | Result |
|---|---|
| `tsc --noEmit` — customer web | ✅ 0 errors |
| `tsc --noEmit` — admin panel | ✅ 0 errors |
| `tsc --noEmit` — partner web | ✅ 0 errors |
| `tsc --noEmit` — mobile | ✅ 0 errors |
| Backend runtime (`/health`) after hot-reload | ✅ 200 |
| `HOMEEIGO_` env-global leaks | ✅ 0 |
| Internal identifiers (pkg/env/metrics/redis/domains/scheme/booking-prefix/release) | ✅ unchanged |
| Residual user-facing `HOMIGO`/`Homigo` | ✅ none (only internal comments/banner/AI-prompt remain) |
| Route / API / DB / WS / env changes | ✅ none |

**Conclusion:** Safe branding migration complete. Every customer-, partner-, admin-, SEO-, email-, PDF-, and app-facing surface now reads **Homeeigo**, while every backend integration, database object, environment variable, API endpoint, queue, metric, Redis key, deep-link scheme, and infrastructure identifier is byte-for-byte unchanged.
