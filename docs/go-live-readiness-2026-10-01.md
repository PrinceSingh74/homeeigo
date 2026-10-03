# Homeeigo go-live readiness map — 2026-10-01

Evidence key: **RUN** = proven at runtime this loop · **CODE** = verified by reading the code path ·
**AUDIT** = static audit of the repository (not executed) · **OWNER/EXT** = needs an owner decision or an
external value. Nothing below claims a production environment exists: none is configured in this
repository. Staging evidence exists for Google Cloud Run (asia-south1).

## 1. What a deployment needs from the owner (blocking)

| Input | Why it blocks | Where it is consumed |
|---|---|---|
| Hosting decision (Cloud Run is the only evidenced target) | No production deploy workflow exists; `staging-deploy.yml` only echoes | `deploy/cloud-run/service.yaml` |
| Domains: one registrable site for web + API | Refresh cookie is `SameSite=Strict`, host-only; the repo names `homigo.com`, `homigo.app` and `homeeigo.com` inconsistently | CORS (`src/index.ts`), `NEXT_PUBLIC_SITE_URL`, mobile `EXPO_PUBLIC_API_URL` |
| Object storage: S3 bucket + IAM, **or** a deliberate `OBJECT_STORAGE_DRIVER=local` on a persistent disk | Production boot now refuses an implicit local-disk fallback (container disks are wiped on restart) | `src/lib/production-config.ts` |
| Secret Manager entries for every secret in `deploy/cloud-run/service.yaml` | The manifest now lists what the code requires; values are not invented | same |
| Live Razorpay + RazorpayX keys, Resend verified domain, Twilio sender, Maps key restrictions | Payment/e-mail/OTP/maps cannot be verified without them | `production-config.ts` |
| Managed Postgres with PITR + backup bucket + restore owner, managed Redis (TLS/auth) | `docs/production-backup-and-alerting-requirements.md` is BLOCKED on these | — |
| Android upload keystores (both apps), partner `EAS_PROJECT_ID`, correct Sentry projects | Release builds are debug-signed today; customer Sentry project is `node-fastify` | `homigo-mobile/eas.json`, both `android/app/build.gradle` |
| `TRUST_PROXY_HOPS` measured on the real front end | Until set, the client IP is the client-controlled left-most X-Forwarded-For entry (boot warns) | `src/lib/client-ip.ts` |

## 2. Component matrix

| Component | Build / start | Health | Status |
|---|---|---|---|
| Backend API | `bun build` / Dockerfile `bun run src/index.ts` on `PORT` (8080 in image) | `/livez` (process only), `/readyz` (DB + draining, public, status-only), `/health` (cached 1 s, detail), `/ready` (ops token) | RUN: probes, 25 MB body cap (413), pool-5 traffic p95 174 ms with leader jobs live. Drain on SIGTERM: CODE only (Windows cannot deliver SIGTERM — verify in the Linux container) |
| WebSocket | in API, bearer token in query | — | CODE: no cookie auth, so no cross-site socket hijack |
| Workers / leader jobs | in-process, leader-locked; anchors on their own pool (`LEADER_ANCHOR_POOL_SIZE`, default 10) | `homigo_leader_anchors_held` | RUN (pool 5 serves traffic) |
| Customer web | `npm run build:release` (refuses local/plain-http backend, requires `NEXT_PUBLIC_SITE_URL`) / `next start -p 3001` | `/healthz` | CODE + unit tests; bundle budget breach on `/services` is an OWNER decision |
| Partner web | `npm run build:release` / `next start -p 3002` | `/healthz` | CODE |
| Admin | `npm run build:release` / `next start -p 3003` | `/healthz` | CODE |
| Customer mobile | `npm run android:release [-- --internal]` (env guard, forced re-bundle, APK scan) | — | RUN earlier; EXT: keystore, API URL |
| Partner mobile | `npm run android:release [-- --internal] [-- --allow-test-payments]` — now with forced re-bundle + APK scan | — | unit tests; EXT: keystore, API URL, `EAS_PROJECT_ID`; no OTA (expo-updates absent) |
| PostgreSQL | `prisma migrate deploy` (manual); `scripts/release/post-deploy-verify.ts` now checks every shipped migration by name | — | RUN (positive + negative control) |
| Redis | `REDIS_URL` (rediss:// supported) | `/health` detail | AUDIT: no per-environment key prefix — a staging process on production Redis would share locks and fan-out (OWNER: separate instances) |
| S3 | `OBJECT_STORAGE_DRIVER`, `AWS_S3_BUCKET` | — | RUN: test DB + real bucket refused before any S3 call |
| Razorpay | keys + webhook secret | — | CODE: raw-body HMAC, timing-safe; dedup now keyed on the signed body (RUN: replay refused) |
| Twilio / OTP | `TWILIO_*`, `SMS_ENABLED`, `OTP_SECRET` | — | RUN: staging never returns the code; 3 comparisons per code under concurrency |
| Sentry | `SENTRY_DSN` per app | — | EXT: projects |
| DNS / TLS | — | — | OWNER/EXT |
| CI | `ci.yml`: web builds moved into the build job (bundle budget enforced in web postbuild); release-env self-test | — | AUDIT: backend lint is report-only (161 errors), no deploy job, no post-deploy smoke |

## 3. Kubernetes / Cloud Run manifests (fixed this loop)

- k8s: `PORT=3000` pinned (image defaults to 8080 while Service, probes and Prometheus used 3000); readiness
  `/readyz` (was token-guarded `/ready` — pods could never become Ready); liveness `/livez`.
- Cloud Run prod: env aligned with `assertProductionConfig` (REDIS_URL, JWT_REFRESH_SECRET, ENCRYPTION_KEY,
  OTP_SECRET, RAZORPAY_KEY_ID, RAZORPAY_ACCOUNT_NUMBER, RESEND_API_KEY, OPS_AUTH_TOKEN, HASH_HMAC_KEY added;
  `PII_MASTER_KEY` secret now mapped to `MASTER_ENCRYPTION_KEY`, the variable the code reads). Startup
  probe `/readyz`, liveness `/livez`.
- Cloud Run staging: `OTP_SECRET` added (every staging deploy script already passed it).
- Still open (AUDIT): `queue-workers.yaml` runs a `src/worker.ts` that does not exist; images use `:latest`.

## 4. Rollback (not tested)

Previous-image rollback is documented in `docs/runbooks/07-rollback.md`. It has not been exercised against
a real environment; migrations are forward-only, so a rollback past a schema change needs the migration's
own reversal plan. Rollback triggers to watch: `/readyz` failing, sustained 5xx, payment/booking state
detectors, `booking_create_provider_unavailable_total` spike, `assignment_dispatch_tick_error_total`.
