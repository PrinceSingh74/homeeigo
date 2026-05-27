# HOMIGO Customer Web (`customer-web`)

**URL:** homigo.com · **Local dev:** http://localhost:3001

Customer booking experience — Home, Services, Booking, AI, Wallet, Profile.

> This folder is `apps/web`. In the platform map it is **customer-web**. Do not import partner or admin UI here.

## Run locally

```bash
# From repo root (works on Windows + Mac)
npm run dev:web

# Or from this folder
npm install
npm run dev
```

**Windows shortcut:** double-click or run `scripts/start-web.ps1` from the repo root.

| App | Port |
|-----|------|
| Customer (this app) | **3001** |
| Partner dashboard | 3002 |
| Admin panel | 3003 |

Do **not** use port 3000 unless you changed the config — the customer site is on **3001**.

## Troubleshooting

1. **Blank page** — Usually a stuck or broken dev server. From repo root run `.\scripts\start-web.ps1` (kills old port 3001, clears `.next`, starts fresh). Wait until terminal shows `Ready`, then wait 30–60s on first compile (OneDrive is slow).
2. **Port already in use** — `.\scripts\start-web.ps1` stops the old process automatically. Manual: `netstat -ano | findstr :3001` then `taskkill /PID <id> /F`
3. **500 / white screen** — Hard refresh `Ctrl+Shift+R` or `npm run dev:fresh` inside `apps/web`.
4. **Layout broken (narrow text, missing hero image)** — Never put `--spacing-xl` / `--spacing-md` in `@theme` (breaks `max-w-xl`). Use `--homigo-space-*` in `:root` only. See [docs/DESIGN.md](../../docs/DESIGN.md#spacing).
4. **`npm run dev` fails at repo root** — Use `npm run dev:web` (not plain `cd apps/web && ...` on older PowerShell).

See [docs/PLATFORM_ARCHITECTURE.md](../../docs/PLATFORM_ARCHITECTURE.md).

## Design system & Storybook

Component library lives in `src/components/ui/`. Design tokens in `src/app/globals.css`. Full guide: [docs/DESIGN.md](../../docs/DESIGN.md).

```bash
# Component documentation (port 6006)
npm run storybook

# Static Storybook build
npm run build-storybook
```

**UI primitives:** `Input`, `Textarea`, `Select`, `Checkbox`, `Radio`, `Button`, `Card`, `Modal`  
**Animations:** `@/lib/animations`

```bash
npm run type-check
npm run build
```
