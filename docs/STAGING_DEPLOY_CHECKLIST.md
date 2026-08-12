# HOMIGO — Staging Deploy Checklist

Use this before pointing real users at staging. Each item maps to a command or manual step.

**Apps & ports (local reference)**

| App | Path | Port |
|-----|------|------|
| Customer web | `apps/web` | 3001 |
| Backend API | `apps/backend` | 3000 |
| Partner web | `apps/partner-web` | 3002 |
| Admin panel | `apps/admin-panel` | 3003 |

---

## 1. Infrastructure

- [ ] PostgreSQL provisioned; `DATABASE_URL` set on API host
- [ ] Redis (if used) reachable
- [ ] DNS: API, customer, partner, admin subdomains
- [ ] TLS certificates active (HTTPS only)
- [ ] Backups enabled + restore tested once

```bash
cd apps/backend && bun run scripts/check-db.ts
```

---

## 2. Backend deploy

- [ ] `prisma migrate deploy` (or `db push` only for throwaway staging)
- [ ] `npm run db:seed` on fresh staging (optional)
- [ ] `npm run build` succeeds
- [ ] Health returns 200

```bash
cd apps/backend
npm run type-check && npm run lint && npm run build
curl -s https://<staging-api>/health
```

### Automated API verification (run against staging `API_URL`)

```bash
cd apps/backend
export API_URL=https://<staging-api>
npm run smoke:all
# Or individually:
npm run smoke:part3      # 67 REST probes
npm run smoke:partner    # /api/v1/partner/* (partner-web stubs)
npm run smoke:provider   # vendor JWT routes
npm run smoke:admin      # /api/admin/* + RBAC
bun run scripts/phase2-lifecycle-checks.ts
```

---

## 3. Environment variables (staging)

| Variable | Required | Notes |
|----------|----------|--------|
| `DATABASE_URL` | Yes | Postgres connection |
| `JWT_SECRET` / refresh secret | Yes | Strong random values |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Yes for live pay | Webhook secret for `/api/payments/webhook` |
| `RAZORPAY_ACCOUNT_NUMBER` | Yes for payouts | RazorpayX business account (payout source) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | For Google login | Redirect URI = staging customer URL |
| `TWILIO_*` or SMS provider | For OTP | Or `REGISTER_REQUIRE_OTP=false` dev-only |
| `RESEND_API_KEY` or email | Password reset | |
| `CORS` / allowed origins | Yes | Include 3001–3003 staging URLs |

Customer web (`apps/web/.env`):

- `NEXT_PUBLIC_API_URL=https://<staging-api>`
- `NEXT_PUBLIC_ENABLE_MOCK_BUSINESS_DATA=false` in staging/production

Partner web (`apps/partner-web/.env`):

- `NEXT_PUBLIC_API_URL=https://<staging-api>`

Admin panel: wire `NEXT_PUBLIC_API_URL` when UI is connected (today uses mock data in `admin-data.ts`).

---

## 4. Customer web (`apps/web`)

- [ ] `npm run build` on CI
- [ ] Login (email + Google) on staging domain
- [ ] Book flow: address → confirm → Razorpay test mode
- [ ] Wallet / bookings / profile load from API
- [ ] No hydration errors on home (services + recommended)

```bash
cd apps/web && npm run type-check && npm run build
```

Manual: Chrome + one mobile browser (Safari or Chrome Android).

---

## 5. Partner web (`apps/partner-web`)

- [ ] Dev server or staging build loads dashboard
- [ ] `npm run smoke:partner` passes against staging API
- [ ] `npm run smoke:provider` passes (real vendor JWT)

**Note:** Partner UI currently calls **stub** `/api/v1/partner/*`. Production partner flows should migrate to real booking APIs (`/api/bookings/:id/accept`, etc.) — provider smoke covers those.

```bash
cd apps/partner-web && npm run type-check && npm run build
```

---

## 6. Admin panel (`apps/admin-panel`)

- [ ] UI deploys on port 3003 / admin subdomain
- [ ] `npm run smoke:admin` passes against staging API
- [ ] Admin login: `admin@homigo.demo` / seed password (change on staging)

**Note:** Admin UI is still **mock KPIs**; API layer is ready at `/api/admin/*`.

```bash
cd apps/admin-panel && npm run build
cd apps/backend && npm run smoke:admin
```

---

## 7. Payments & webhooks

- [ ] Razorpay **test** keys on staging
- [ ] Webhook URL: `https://<staging-api>/api/payments/webhook`
- [ ] Test card/UPI payment end-to-end
- [ ] Verify `POST /api/payments/verify` after checkout

---

## 8. OAuth & SMS

- [ ] Google Cloud redirect URIs include staging callback
- [ ] Apple Sign In (if enabled) service IDs + redirect
- [ ] OTP SMS delivers to test phone (or dev OTP documented)

---

## 9. Real-time

- [ ] `WS /ws/notifications?token=...` connects from staging frontends
- [ ] Tracking WS for active booking (if used on staging)

---

## 10. Security & ops

- [ ] Rate limits enabled (auth routes)
- [ ] No `.env` committed
- [ ] Error monitoring (e.g. Sentry) configured
- [ ] Logs aggregated; no passwords in logs
- [ ] Seed/demo accounts disabled or password-rotated on production

---

## 11. Sign-off

| Suite | Command | Target |
|-------|---------|--------|
| Full API smoke | `npm run smoke:all` | 0 failures |
| QA report | `docs/QA_VERIFICATION_REPORT.md` | Reviewed |
| Manual E2E | Book → pay → track | Product sign-off |

**Staging approved by:** _______________ **Date:** _______________
