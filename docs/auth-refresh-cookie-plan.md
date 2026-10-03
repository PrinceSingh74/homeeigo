# Web refresh tokens in HttpOnly cookies — IMPLEMENTED (2026-09-20)

Status: **DONE for the three web apps.** Mobile is unchanged by design.

## What changed
| Surface | Access token | Refresh token |
|---|---|---|
| web (customer) | memory only | **HttpOnly cookie `hg_rt_customer`** |
| partner-web | memory only | **HttpOnly cookie `hg_rt_partner`** |
| admin-panel | memory only | **HttpOnly cookie `hg_rt_admin`** |
| mobile apps | SecureStore | SecureStore (request body, unchanged) |

`localStorage` now holds only the user profile, so the signed-in shell can render before the first
refresh returns. No token of any kind is persisted in the browser.

### Backend (`src/lib/auth-cookies.ts`, `src/routes/auth.ts`)
- One cookie per audience, because a single API host serves all three apps and cookies ignore the
  port: `Path=/api/auth; HttpOnly; SameSite=Strict; Secure` (production), `Max-Age` = refresh TTL.
- A web client identifies itself with `X-Homigo-Audience: customer|partner|admin`.
  - Login / register / verify-OTP / Google / Apple: set that audience's cookie **and omit
    `refreshToken` from the response body**, so JavaScript never receives it.
  - `/api/auth/refresh`: reads the cookie, rotates it in place, returns only an access token. A
    request with no audience header ignores cookies entirely (no ambient authority).
  - `/api/auth/logout`: revokes the cookie's session **server-side** and clears only that audience's
    cookie — a partner logout cannot sign a customer out of the same browser.
  - A rejected cookie is cleared, so a dead session stops being replayed.
- The old `homigo_access` / `homigo_refresh` pair is gone. Nothing read it, and it put a second
  long-lived copy of the refresh token in the browser.

### CSRF
Auth is otherwise bearer-based, so only `/api/auth/*` is cookie-reachable, and it is protected three
ways: `SameSite=Strict` (never sent cross-site), the required custom header (needs a CORS preflight
the allowlist refuses), and `Path=/api/auth` (not attached to ordinary API calls).

### Evidence
- `src/__tests__/auth-refresh-cookie.integration.test.ts` — 7 cases: rotation, token never returned
  to JS, cookie attributes, reuse detection through the cookie, three audiences coexisting in one
  jar, no-audience requests refused, mobile body-token mode unaffected, logout revoking server-side.
- `src/__tests__/refresh-token-reuse.integration.test.ts` — reuse still burns the family and bumps
  the auth epoch.
- Isolated browser E2E (partner-web + admin) against the isolated backend.

## Deployment constraint (must be checked before release)
`SameSite=Strict` requires the web origin and the API origin to be **the same site** (same
registrable domain), e.g. `app.homeeigo.com` + `api.homeeigo.com`. That holds in development
(`localhost:3001/3002/3003` → `localhost:3000`, where the port is not part of the site).

If the API is ever served from a different registrable domain, the cookie will not be sent and
refresh will fail closed (users are logged out after the access token expires, no security hole).
In that case the deployment must either move the API under the same domain or the cookie policy must
be revisited — do not "fix" it by loosening to `SameSite=None`, which reopens CSRF.

**Owner:** platform engineering — confirm the production domain layout.
