# Web E2E (Playwright)

Automates the customer path: **signup → SMS OTP (dev) → book**.

## Prerequisites

- PostgreSQL running (`apps/backend`: `docker compose up -d`, `bun run db:migrate`)
- Backend `.env` with valid `DATABASE_URL` (Twilio **not** required — OTP is returned as `devOtp` in API responses)

## Run

From `apps/web`:

```bash
npm install
npx playwright install chromium
npm run test:e2e
```

Playwright starts **backend** (`:3000`) and **web** (`:3001`) unless they are already running.

### Use existing servers

```bash
# Terminal 1 — apps/backend
bun run dev

# Terminal 2 — apps/web
npm run dev

# Terminal 3 — apps/web
$env:E2E_SKIP_SERVERS="1"; npm run test:e2e
```

## Scripts

| Script | Description |
|--------|-------------|
| `npm run test:e2e` | Headless Chromium |
| `npm run test:e2e:ui` | Playwright UI mode |
| `npm run test:e2e:headed` | Visible browser |

## Notes

- Each run registers a unique `e2e+*@homigo.test` user.
- Razorpay checkout is mocked in-browser; booking success modal is the assertion target.
- Payment signature verification may fail in the API after the modal — that is expected without real Razorpay keys.

## CI

GitHub Actions workflow `.github/workflows/e2e.yml` runs this suite (plus admin and partner login specs) on push/PR to `main`/`master` with PostgreSQL + migrate + seed.
