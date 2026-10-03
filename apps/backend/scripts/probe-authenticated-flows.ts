/**
 * Authenticated runtime probe: log in as the demo accounts and exercise what a real session can and
 * cannot reach, against the running server.
 *
 * `probe-endpoint-authorization.ts` proves the refusals (no credentials, forged token). It cannot prove
 * that a legitimate session still works — and after a schema migration and a security-hardening pass,
 * "legitimate flows still work" is the half most likely to regress silently.
 *
 * The demo password is read from `ensure-demo-users.ts` in-process and never printed. Only the local
 * demo accounts are used. Logging in writes a session/refresh-token row; no business table is touched.
 *
 *   bun run scripts/probe-authenticated-flows.ts [--base http://127.0.0.1:3000]
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const baseIdx = process.argv.indexOf("--base");
const BASE = baseIdx >= 0 ? process.argv[baseIdx + 1]! : "http://127.0.0.1:3000";

const seeder = readFileSync(join(import.meta.dir, "ensure-demo-users.ts"), "utf8");
const pw = seeder.match(/const DEMO_PASSWORD\s*=\s*["'`]([^"'`]+)["'`]/)?.[1];
if (!pw) {
  console.error("REFUSING: could not read DEMO_PASSWORD from ensure-demo-users.ts");
  process.exit(2);
}

type R = { status: number; body: any; setCookie: string[] };
async function call(method: string, path: string, opts: { token?: string; body?: unknown; cookie?: string } = {}): Promise<R> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  if (opts.cookie) headers.cookie = opts.cookie;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    signal: AbortSignal.timeout(15_000),
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, body, setCookie: res.headers.getSetCookie?.() ?? [] };
}

async function login(email: string) {
  const r = await call("POST", "/api/auth/login", { body: { email, password: pw } });
  const token = r.body?.data?.accessToken ?? r.body?.data?.token ?? r.body?.accessToken ?? r.body?.token;
  const cookie = r.setCookie.map((c) => c.split(";")[0]).join("; ");
  // Without an `X-Homigo-Audience` header the server uses body mode (mobile / older web): the
  // refresh token comes back in the body rather than a cookie. Both are legitimate client shapes.
  const refreshToken = r.body?.data?.refreshToken as string | undefined;
  return { status: r.status, token: token as string | undefined, cookie, refreshToken, code: r.body?.code };
}

const results: Array<{ name: string; ok: boolean; detail: string }> = [];
const check = (name: string, ok: boolean, detail: string) => {
  results.push({ name, ok, detail });
  console.log(`   ${ok ? "ok  " : "FAIL"}  ${name.padEnd(52)} ${detail}`);
};

console.log(`[authn-probe] target: ${BASE}\n`);

const cust = await login("customer@homigo.demo");
check("customer login succeeds", cust.status === 200 && !!cust.token, `HTTP ${cust.status}${cust.code ? ` ${cust.code}` : ""}`);

if (cust.token) {
  const me = await call("GET", "/api/users/me", { token: cust.token });
  check("customer reads own profile", me.status === 200, `HTTP ${me.status}`);
  const up = await call("GET", "/api/bookings/upcoming", { token: cust.token });
  check("customer reads own upcoming bookings", up.status === 200, `HTTP ${up.status}`);
  const wal = await call("GET", "/api/wallet/balance", { token: cust.token });
  check("customer reads own wallet", wal.status === 200, `HTTP ${wal.status}`);
  const adm = await call("GET", "/api/admin/dashboard", { token: cust.token });
  check("customer is REFUSED the admin dashboard", adm.status === 403 || adm.status === 401, `HTTP ${adm.status}`);
  const earn = await call("GET", "/api/providers/me/earnings", { token: cust.token });
  check("customer is REFUSED partner earnings", earn.status === 403 || earn.status === 401, `HTTP ${earn.status}`);
  // Ownership: a booking id that is not this customer's must not be readable.
  const other = await call("GET", "/api/bookings/00000000-0000-0000-0000-000000000000", { token: cust.token });
  check("customer cannot read a booking that is not theirs", other.status === 404 || other.status === 403, `HTTP ${other.status}`);
  if (cust.refreshToken) {
    const ref = await call("POST", "/api/auth/refresh", { body: { refreshToken: cust.refreshToken } });
    const fresh = ref.body?.data?.accessToken as string | undefined;
    check("refresh (body mode) issues a new access token", ref.status === 200 && !!fresh, `HTTP ${ref.status}`);
    if (fresh) {
      const me2 = await call("GET", "/api/users/me", { token: fresh });
      check("the refreshed token authenticates", me2.status === 200, `HTTP ${me2.status}`);
    }
    // Rotation. refresh-token.service has a deliberate 20s grace window: a replay inside it is a
    // racing tab, answered with the live successor rather than a new rotation. A replay after it is
    // treated as theft and burns the family. Both halves are checked — the first probe version
    // called the in-window 200 a failure, which was the probe misreading a documented design.
    const inWindow = await call("POST", "/api/auth/refresh", { body: { refreshToken: cust.refreshToken } });
    check("replay inside the 20s grace window answers with the successor", inWindow.status === 200, `HTTP ${inWindow.status}`);
    await new Promise((r) => setTimeout(r, 21_000));
    const late = await call("POST", "/api/auth/refresh", { body: { refreshToken: cust.refreshToken } });
    check("replay AFTER the grace window is refused", late.status === 401 || late.status === 403, `HTTP ${late.status}`);
  } else {
    check("refresh (body mode) issues a new access token", false, "no refresh token returned on login");
  }
}

const part = await login("partner@homigo.demo");
check("partner login succeeds", part.status === 200 && !!part.token, `HTTP ${part.status}${part.code ? ` ${part.code}` : ""}`);
if (part.token) {
  const e = await call("GET", "/api/providers/me/earnings", { token: part.token });
  check("partner reads own earnings", e.status === 200, `HTTP ${e.status}`);
  const adm = await call("GET", "/api/admin/dashboard", { token: part.token });
  check("partner is REFUSED the admin dashboard", adm.status === 403 || adm.status === 401, `HTTP ${adm.status}`);
}

const admin = await login("admin@homigo.demo");
check("admin login succeeds", admin.status === 200 && !!admin.token, `HTTP ${admin.status}${admin.code ? ` ${admin.code}` : ""}`);
if (admin.token) {
  for (const p of ["/api/admin/dashboard", "/api/admin/analytics", "/api/admin/finance/refunds", "/api/admin/governance/ai-budgets"]) {
    const r = await call("GET", p, { token: admin.token });
    check(`admin reads ${p}`, r.status === 200, `HTTP ${r.status}`);
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n[authn-probe] ${failed.length ? "FAIL" : "PASS"} — ${results.length - failed.length}/${results.length}`);
process.exit(failed.length ? 1 : 0);
