# HOMEEIGO Partner Mobile

Native Expo app for HOMEEIGO service partners — full **Partner OS** companion to `apps/partner-web`.

## Quick start

```bash
cd homigo-partner-mobile
cp .env.example .env.local
# Set EXPO_PUBLIC_API_URL to your backend (default http://localhost:3000)

npm install
npm start
```

Scan the QR code with Expo Go, or press `a` / `i` for Android / iOS simulator.

## Partner OS modules (parity with partner-web)

| HQ Section | Mobile screens |
|------------|----------------|
| **Home** | Dashboard with live KPIs, requests, schedule, performance |
| **Work HQ** | Live status, requests/bookings, route center, attendance, schedule, service history |
| **Earnings HQ** | Overview, earnings, wallet, payouts, incentives, tax, forecast |
| **Performance HQ** | Reviews, scorecard, rankings, quality insights, analytics |
| **AI HQ** | AI assistant, demand forecast, route AI, growth advisor |
| **Territory HQ** | Navigation, heatmap, coverage areas, territory analytics |
| **Partner Academy** | Training modules, certifications |
| **Trust & Compliance** | Documents, verification, compliance score |
| **Rewards HQ** | Rewards, badges, referrals |
| **Wellbeing HQ** | Insurance, SOS, community |
| **Account** | Profile, notifications, settings, support, membership, invoices, availability, live map |

**Bottom tabs:** Home · Requests · Wallet · HQ (full nav) · Profile

All screens use the same live backend APIs as `apps/partner-web`.

## Related apps

| App | Path |
|-----|------|
| Partner web (HQ) | `apps/partner-web` |
| Customer mobile | `homigo-mobile` |
| Admin panel | `apps/admin-panel` |
