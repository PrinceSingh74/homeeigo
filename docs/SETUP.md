# HOMIGO — Local Setup

How to get the whole project running on a new machine from a fresh `git clone`.
Steps 1–5 were verified end to end on a fresh clone of `main` against an empty database.

## What is in git and what is not

| In the repository | Not in the repository (get it from the project owner, privately) |
|---|---|
| All source code: backend, web, partner-web, admin-panel, both mobile apps | `.env` files (database password, API keys, encryption keys) |
| Database schema and every migration (`apps/backend/prisma/`) | Real database data (users, bookings, wallet) |
| Seed scripts that create demo data | Uploaded files (`apps/backend/uploads/`: partner documents, photos) |
| `.env.example` template for every app | Database dumps (`backups/`, `apps/backend/backups/`) |

Never commit `.env` files, database dumps, or `uploads/`. They contain secrets and customers' personal data.

## Prerequisites

- **Git**
- **Node.js 20 or newer** — frontend tooling and the mobile apps
- **Bun 1.3 or newer** — backend runtime ([bun.sh](https://bun.sh))
- **Docker Desktop** — runs PostgreSQL 16 and Redis locally
- **Android Studio** (only for the mobile apps) — Android SDK and an emulator

## Ports

| Service | URL |
|---|---|
| Backend API | http://localhost:3000 (health: `/health`, docs: `/swagger`) |
| Customer web (`apps/web`) | http://localhost:3001 |
| Partner web (`apps/partner-web`) | http://localhost:3002 |
| Admin panel (`apps/admin-panel`) | http://localhost:3003 |
| PostgreSQL (Docker) | `localhost:5433`, user `postgres`, password `homigo_dev`, database `homigo_db` |
| Redis (Docker) | `localhost:6379` |
| PgBouncer (Docker) | `localhost:6432` |

## 1. Clone and install

```bash
git clone https://github.com/PrinceSingh74/homeeigo.git homigo
cd homigo

# Root: installs both mobile apps (npm workspaces)
npm install

# Backend uses Bun
cd apps/backend && bun install && cd ../..

# Each web app has its own lockfile
cd apps/web && npm install && cd ../..
cd apps/partner-web && npm install && cd ../..
cd apps/admin-panel && npm install && cd ../..
```

## 2. Environment files

Copy every template. The defaults work for local development; external services (Razorpay, Twilio,
Google, Sentry, Resend) stay disabled until you fill in their keys.

```bash
cp apps/backend/.env.example apps/backend/.env
cp apps/web/.env.example apps/web/.env.local
cp apps/partner-web/.env.example apps/partner-web/.env.local
cp apps/admin-panel/.env.example apps/admin-panel/.env.local
cp homigo-mobile/.env.example homigo-mobile/.env
cp homigo-partner-mobile/.env.example homigo-partner-mobile/.env.local
```

(`cp` works in PowerShell too.)

## 3. Start PostgreSQL and Redis

```bash
cd apps/backend
docker compose up -d
```

This starts `homigo-postgres`, `homigo-redis` and `homigo-pgbouncer`. Data is kept in the Docker
volume `homigo_pg_data` between restarts.

## 4. Create the database

Choose **one** of the two options.

### Option A — fresh database with demo data

```bash
cd apps/backend
bunx prisma migrate deploy   # applies every migration in prisma/migrations
bunx prisma generate         # generates the Prisma client
bun run db:seed              # demo services, users and bookings
```

Demo logins created by the seed (password `Homigo@123` for all):

- Customer: `customer@homigo.demo`
- Partner: `partner@homigo.demo`
- Admin: `admin@homigo.demo`

Optional: `bun run db:seed-services` adds the full service catalogue.

Use `prisma migrate deploy`, not `prisma migrate dev` or `bun run db:setup`. `migrate dev` can
generate a new migration on your machine; only run it when you are deliberately changing
`schema.prisma`.

### Option B — a copy of an existing database

Use this when you need the same data as another developer. Ask the project owner for:

1. A `.dump` file (PostgreSQL custom format). A plain `.sql` file will not work with the restore script.
2. Their values of `ENCRYPTION_KEY`, `MASTER_ENCRYPTION_KEY`, `HASH_HMAC_KEY` and `JWT_SECRET`.
   Phone numbers, addresses and partner documents are stored encrypted. With different keys the
   restored data cannot be read and lookups (for example login by phone) will fail.
3. Optionally, a zip of `apps/backend/uploads/` if you need the uploaded documents and photos.

Share these over a private channel, never through git, chat groups or email lists.

Put the keys into `apps/backend/.env`, copy the dump into `apps/backend/backups/`, then:

```powershell
# PowerShell
cd apps/backend
$env:RESTORE_CONFIRM = "yes"
bun --env-file=.env run scripts/restore-postgres.ts ./backups/<file>.dump
bunx prisma migrate deploy   # applies any migrations newer than the dump
bunx prisma generate
```

```bash
# bash / macOS / Linux
cd apps/backend
RESTORE_CONFIRM=yes bun --env-file=.env run scripts/restore-postgres.ts ./backups/<file>.dump
bunx prisma migrate deploy
bunx prisma generate
```

The restore replaces the contents of the database in `DATABASE_URL` (it takes a safety snapshot first).

To create a dump to share (project owner):

```bash
cd apps/backend
bun run backup:db    # writes a .dump and .sha256 into apps/backend/backups/
```

## 5. Run the apps

From the repository root:

```bash
npm run dev:backend   # http://localhost:3000 — check http://localhost:3000/health
npm run dev:web       # http://localhost:3001
npm run dev:partner   # http://localhost:3002
npm run dev:admin     # http://localhost:3003

# or backend + customer + partner + admin together
npm run dev:all
```

## 6. Mobile apps

```bash
npm run dev:mobile           # customer app (Expo)
npm run dev:partner-mobile   # partner app (Expo)
```

On a physical phone, `localhost` is the phone itself. Set `EXPO_PUBLIC_API_URL` in the app's env file
to your computer's LAN IP (find it with `ipconfig` / `ifconfig`), for example
`EXPO_PUBLIC_API_URL=http://192.168.1.20:3000`. The Android emulator reaches your computer at
`http://10.0.2.2:3000`.

For a native Android build: `cd homigo-mobile && npx expo run:android` (same for `homigo-partner-mobile`).

## Troubleshooting

- **`/health` shows `"database": "error"`** — Docker is not running or `DATABASE_URL` in
  `apps/backend/.env` does not point at `localhost:5433`.
- **Port already in use** — another copy of the app is running. Stop it or change `PORT` in
  `apps/backend/.env` (and `BACKEND_ORIGIN` in the web apps' `.env.local`).
- **Login fails after restoring a dump** — the encryption keys in `.env` do not match the ones
  the dump was created with (see Option B).
- **Prisma client errors after pulling new code** — run `bunx prisma migrate deploy` and
  `bunx prisma generate` in `apps/backend` again.

## QA references

- Integration verification report: [`docs/QA_VERIFICATION_REPORT.md`](./QA_VERIFICATION_REPORT.md)
- Staging deploy checklist: [`docs/STAGING_DEPLOY_CHECKLIST.md`](./STAGING_DEPLOY_CHECKLIST.md)
- Backend smoke scripts (API must be running): `cd apps/backend && bun run smoke:all`
