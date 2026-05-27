# HOMIGO Partner / Vendor Web

**URL:** partner.homigo.com (or pro.homigo.com) · **Port:** 3002

Dark premium ops UI for service professionals — **fully separate** from `apps/web` (customer).

## Run locally

```bash
cd apps/partner-web
npm install
npm run dev
```

Open http://localhost:3002 — demo login completes KYC flow and enters dashboard.

## Features

| Route | Feature |
|-------|---------|
| `/login` | Phone OTP + KYC + AI doc verification |
| `/` | Dashboard |
| `/requests` | Live booking requests |
| `/map` | Live tracking |
| `/wallet` | Earnings & withdraw |
| `/ai` | Vendor AI assistant |
| `/analytics` | Performance charts |
| `/reviews` | Customer reviews |
| `/availability` | Online/offline toggle |
| `/profile` | KYC, docs, categories |

## Design tokens

- Background `#071028`
- Card `#0F172A`
- Primary `#2563EB`
- Success `#22C55E`

## API

Set `NEXT_PUBLIC_API_URL=http://localhost:3000` — partner routes under `/api/v1/partner/*`.
