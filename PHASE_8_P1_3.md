# PHASE 8 — P1-3: Partner Mobile EAS + Sentry + Maps Configuration

**Mode: SAFE OPTION (A)** — all implementation and configuration that does not require real
external credentials is complete. **Nothing was fabricated**: no Expo `projectId`, no Expo account
action, no Sentry DSN, no Google Maps API key.

| Gate | Status |
|---|---|
| **P1-3 CONFIGURATION** | `CONFIGURATION_COMPLETE` |
| **EAS_VERIFICATION** | `EXTERNAL_ARTIFACT_REQUIRED` |
| **SENTRY_VERIFICATION** | `EXTERNAL_ARTIFACT_REQUIRED` |
| **MAPS_VERIFICATION** | `EXTERNAL_ARTIFACT_REQUIRED` |
| Local config validation | `CONFIG_VALIDATED` |
| Local runtime | `LOCAL_RUNTIME_VERIFIED` (Metro bundle) |
| Device/cloud build | `EAS_BUILD_NOT_VERIFIED` |

`CONFIG_VALIDATED` and `CREDENTIAL_VERIFIED` are kept strictly separate throughout. Nothing below
claims a live Sentry event, a completed EAS build, or a working Maps render.

---

## 1. Implementation status

| Area | Status | Notes |
|---|---|---|
| EAS build profiles | `IMPLEMENTED` + `CONFIG_VALIDATED` | `eas.json` with development/preview/preview-aab/production, mirroring the customer app's conventions |
| EAS project identity | `EXTERNAL_ARTIFACT_REQUIRED` | `projectId` wired from `EAS_PROJECT_ID`; **not invented** |
| OTA updates | `IMPLEMENTED` (gated) | `updates.url` + `runtimeVersion` derive from `EAS_PROJECT_ID`; omitted entirely when absent |
| Sentry SDK | `IMPLEMENTED` | `@sentry/react-native@~7.2.0` — same major/minor as customer app |
| Sentry init | `IMPLEMENTED` + `LOCAL_RUNTIME_VERIFIED` | DSN-gated, clean no-op when unset |
| Sentry source-map upload | `IMPLEMENTED` (gated) | Expo plugin added only when `SENTRY_ORG`+`SENTRY_PROJECT` are present |
| Sentry PII scrubbing | `IMPLEMENTED` + **8/8 tests passing** | Verifiable without a DSN |
| Error boundary | `IMPLEMENTED` | App-root, recoverable fallback, reports via Sentry |
| Environment separation | `IMPLEMENTED` + `CONFIG_VALIDATED` | `EXPO_PUBLIC_APP_ENV` set per EAS profile |
| Release/version tagging | `IMPLEMENTED` | `homigo-partner-mobile@<version>` + `dist` = native build number |
| Google Maps (Android) | `EXTERNAL_ARTIFACT_REQUIRED` | Key wired from env; **customer app's key deliberately NOT copied** |

## 2. Files changed

| File | Change |
|---|---|
| `homigo-partner-mobile/eas.json` | **new** — 4 build profiles |
| `homigo-partner-mobile/app.config.js` | extended — Sentry plugin, EAS projectId, updates URL, Maps key (all env-gated) |
| `homigo-partner-mobile/src/lib/observability/sentry.ts` | **new** — init, user tagging, release/dist, env separation, `beforeSend`/`beforeBreadcrumb` scrubbing |
| `homigo-partner-mobile/src/lib/observability/scrub.ts` | **new** — RN-free PII/secret scrubber (pure, unit-testable) |
| `homigo-partner-mobile/src/components/ErrorBoundary.tsx` | **new** — app-root boundary |
| `homigo-partner-mobile/app/_layout.tsx` | `initSentry()` before mount, `<ErrorBoundary>` wrap, `setSentryUser` on auth change |
| `homigo-partner-mobile/.env.example` | documented every required variable |
| `homigo-partner-mobile/package.json` | `@sentry/react-native` added |
| `homigo-partner-mobile/e2e/p1-3-sentry-scrub.spec.ts` | **new** — 8 scrubbing tests |

## 3. Configuration added

**`eas.json`** — `appVersionSource: "remote"`, `cli.version >= 14.0.0`, and:

| Profile | Channel | Distribution | Android | `EXPO_PUBLIC_APP_ENV` |
|---|---|---|---|---|
| `development` | development | internal (dev client) | apk | development |
| `preview` | preview | internal | apk | preview |
| `preview-aab` | preview | extends preview | app-bundle | (inherited) |
| `production` | production | store (autoIncrement) | app-bundle | production |

Deliberately **omitted** `SENTRY_ORG`/`SENTRY_PROJECT` literals that the customer app hardcodes in
its `eas.json` — the partner app needs its **own** Sentry project, which does not exist yet.
Supplying them as EAS environment variables/secrets keeps the two apps' crash streams separate.

## 4. Environment variables required

| Variable | Scope | Purpose | Required for |
|---|---|---|---|
| `EAS_PROJECT_ID` | build | EAS project identity + OTA update URL | any EAS build/update |
| `EXPO_PUBLIC_SENTRY_DSN` | runtime | Sentry event delivery | Sentry reporting |
| `SENTRY_ORG` | build | source-map upload | readable stack traces |
| `SENTRY_PROJECT` | build | source-map upload | readable stack traces |
| `SENTRY_AUTH_TOKEN` | build (**secret**) | Sentry CLI auth | source-map upload |
| `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY` | build | Android Maps render | P1-2 map on Android |
| `EXPO_PUBLIC_APP_ENV` | build | environment separation | set automatically per profile |

Every one is **absent-safe**: when unset, the corresponding feature is omitted from the config
rather than filled with a placeholder. A placeholder produces a *silently broken* build (blank grey
map, crashes filed to the wrong project, OTA pointing at another app); an absent value fails loudly
and is diagnosable.

## 5. Local validation — `CONFIG_VALIDATED`

| Check | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | **PASS** — 0 errors |
| `eas.json` JSON + schema shape | `node -e "require('./eas.json')"` | **PASS** — 4 profiles resolve |
| Expo config (no credentials) | `npx expo config --type public --json` | **PASS** — resolves cleanly; `extra.eas: null`, `updates: null`, no maps key. **No fabricated values leak in.** |
| Expo config (credentials present) | same, with env vars set to obvious dummies | **PASS** — Sentry plugin wired, `extra.eas.projectId` set, `updates.url` = `https://u.expo.dev/<id>`, `runtimeVersion.policy: appVersion` |
| Maps key wiring | `npx expo config --type prebuild --json` | **PASS** — key lands in `android.config.googleMaps.apiKey`; **stripped from `--type public`** (Expo's own secret hygiene) |
| Metro bundle | `npx expo export --platform android` | **PASS** — 8 MB Hermes bundle, no errors |
| Bundle content | string scan of `.hbc` | Sentry release string + ErrorBoundary copy **present**; dev-only strings correctly dead-code-eliminated |
| Scrubbing tests | `npx playwright test e2e/p1-3-sentry-scrub.spec.ts` | **8/8 PASS** |
| Full partner regression | P1-1 + P1-2 + P1-3 suites | **43/43 PASS** |

The dummy values used to prove the credential-present path (`test-org`, `TEST_ONLY_NOT_A_REAL_KEY`,
an all-zero UUID) were passed as one-shot environment variables and **never written to any file**;
the generated config artifacts were deleted immediately.

## 6. EAS validation — `EXTERNAL_ARTIFACT_REQUIRED`

An Expo account **is** authenticated in this environment:

```
$ npx eas-cli whoami
Accounts:
• harekrishna_2003 (Role: Owner)
• harekrishna2003s-team (Role: Owner)
```

So the boundary is narrower than "no credentials" — what is missing is specifically an **EAS
project id**, which EAS itself reports:

```
$ npx eas-cli config --platform android --profile production
EAS project not configured. This command cannot configure it in non-interactive mode.
  eas init --id <project-id> --non-interactive     # link an existing project
  eas init --account <account-name> --non-interactive   # create a new project
Accounts you can create projects in: harekrishna_2003, harekrishna2003s-team
```

**`eas init` was deliberately NOT run.** It creates a persistent cloud resource on the user's real
Expo account — an outward-facing, hard-to-reverse action, and squarely outside "work that does not
require real external credentials" (SAFE OPTION A). It needs explicit authorization.

- **Missing artifact**: EAS project id
- **Required provider**: Expo (account already authenticated)
- **Environment variable**: `EAS_PROJECT_ID`
- **Configuration location**: `homigo-partner-mobile/app.config.js` → `expo.extra.eas.projectId`
- **Verification command**: `npx eas-cli config --platform android --profile production`

## 7. Sentry status — `EXTERNAL_ARTIFACT_REQUIRED`

Structurally complete and locally verified; **no live delivery is claimed**.

- ✅ Native init before router mount; JS + native crash handling; auto session tracking
- ✅ Environment separation (`EXPO_PUBLIC_APP_ENV`, falls back to `__DEV__`) — a preview build is
  never mislabelled "production"
- ✅ Release `homigo-partner-mobile@<version>`, `dist` = native build number
- ✅ Error-boundary integration + global hook bridge
- ✅ User context = **partner id and role only**, never name/phone/PII
- ✅ PII scrubbing on `beforeSend` **and** `beforeBreadcrumb`, **8/8 tests**
- ⛔ **NOT VERIFIED**: that an event actually reaches a Sentry project (needs a DSN)
- ⛔ **NOT VERIFIED**: source-map upload (needs `SENTRY_ORG`/`SENTRY_PROJECT`/`SENTRY_AUTH_TOKEN`)

- **Missing artifact**: Sentry project + DSN + auth token for the **partner** app
- **Required provider**: Sentry (org `homigo-g4` exists; the partner app needs its **own project**)
- **Environment variables**: `EXPO_PUBLIC_SENTRY_DSN`, `SENTRY_ORG`, `SENTRY_PROJECT`, `SENTRY_AUTH_TOKEN`
- **Configuration location**: `src/lib/observability/sentry.ts` (runtime DSN), `app.config.js` (build-time plugin)
- **Verification command**: after setting the DSN, `npx expo start` and confirm the boot log no
  longer prints `[Homeeigo Partner][sentry] disabled`, then trigger an error and confirm arrival in
  the Sentry issue feed.

## 8. Maps status — `EXTERNAL_ARTIFACT_REQUIRED`

- ✅ Wired via `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`, verified to land in the prebuild native config
- ✅ Confirmed **stripped** from the public manifest (`--type public`) — no leak into OTA metadata
- ✅ Customer app's key deliberately **not** copied (it is restricted to a different package)
- ⛔ **NOT VERIFIED**: an actual Android map render

- **Missing artifact**: Google Maps Android API key
- **Required provider**: Google Cloud Console — enable **Maps SDK for Android**, create an API key,
  restrict it to **Android apps** with package `com.homeeigo.partner` and the signing SHA-1
  fingerprint (from `npx eas-cli credentials`)
- **Environment variable**: `EXPO_PUBLIC_GOOGLE_MAPS_API_KEY`
- **Configuration location**: `app.config.js` → `expo.android.config.googleMaps.apiKey`
- **Verification command**: `npx expo config --type prebuild --json` to confirm wiring, then open
  the Live Map HQ screen on an Android build and confirm tiles render (iOS uses Apple Maps and
  needs no key)

## 9. Security verification

| Check | Result |
|---|---|
| Secrets not committed | **PASS** — `.env`/`.env.local` ignored by root `.gitignore` (lines 8, 11) and untracked |
| No hardcoded DSN / API key / projectId | **PASS** — regex scan across `src/`, `app/`, `app.json`, `app.config.js`, `eas.json` found none |
| Customer app's Maps key not copied | **PASS** — repo-wide scan for that key in the partner app returns nothing |
| No credentials in the shipped bundle | **PASS** — scanned the 8 MB Hermes bundle for `AIza…` / Sentry DSN patterns; none |
| Dev credentials not reused as production | **PASS** — no credential of any kind is committed; each environment supplies its own |
| Maps key package-restricted | **DOCUMENTED** — restriction to `com.homeeigo.partner` is specified as a provisioning requirement (§8); cannot be enforced from code |
| Sentry receives no tokens/OTP/payment data | **PASS** — 8/8 scrubbing tests cover tokens, OTPs, Aadhaar/PAN, bank account/IFSC, CVV/card, Razorpay signatures, nested objects, arrays, and URL query strings |
| Source maps not publicly exposed | **PASS by construction** — upload requires `SENTRY_AUTH_TOKEN` (an EAS secret) and goes to Sentry, never into the bundle or a public artifact |
| Environment separation works | **PASS** — verified `EXPO_PUBLIC_APP_ENV` resolves per profile; runtime falls back to `__DEV__` |

## 10. Exact commands after credentials are supplied

```bash
cd homigo-partner-mobile

# 1) EAS project (creates a real cloud resource — requires explicit authorization)
npx eas-cli init --account harekrishna_2003 --non-interactive
#    then put the printed id in .env.local / EAS env as EAS_PROJECT_ID
npx eas-cli config --platform android --profile production   # verify

# 2) Sentry (partner app's OWN project)
#    .env.local:  EXPO_PUBLIC_SENTRY_DSN=...
#    EAS env:     SENTRY_ORG, SENTRY_PROJECT
npx eas-cli env:create --name SENTRY_AUTH_TOKEN --type secret --scope project

# 3) Google Maps (Android)
npx eas-cli credentials              # read the signing SHA-1 to restrict the key
#    set EXPO_PUBLIC_GOOGLE_MAPS_API_KEY
npx expo config --type prebuild --json | grep -A2 googleMaps   # verify wiring

# 4) Build + verify
npx eas-cli build --platform android --profile preview
#    install the APK, then confirm:
#      - map tiles render on the Live Map HQ screen        (MAPS_VERIFICATION)
#      - a triggered error appears in Sentry               (SENTRY_VERIFICATION)
#      - a real push notification is delivered             (completes P1-1's NOT_VERIFIED half)
```

Step 4 also closes the two verification gaps carried from earlier items: **P1-1's physical push
delivery** and **P1-2's on-device map render**.
