# HOMIGO Business HQ (Admin)

**URL:** admin.homigo.com · **Port:** 3003

Poora **company / business** yahan manage hota hai — vendors list, bookings, payments, fraud, analytics.

| App | Kaun use kare | Port |
|-----|----------------|------|
| Customer (`apps/web`) | Ghar wale users | 3001 |
| Partner (`apps/partner-web`) | Electrician, AC wale | 3002 |
| **Business HQ (ye app)** | Tum / ops / founders | **3003** |

```bash
cd apps/admin-panel
npm install
npm run dev
```

Open **http://localhost:3003** → login → Business overview.
