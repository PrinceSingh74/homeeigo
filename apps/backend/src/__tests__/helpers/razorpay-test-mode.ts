/**
 * Opt-in preload for REAL Razorpay TEST-MODE integration runs. Never loaded by default.
 *
 *   cd apps/backend
 *   HOMIGO_RAZORPAY_TEST_MODE=1 bun test --preload ./src/__tests__/helpers/razorpay-test-mode.ts \
 *     "D:/homigo/apps/backend/src/__tests__/razorpay-test-mode.real.test.ts" --timeout 600000
 *
 * Under `bun test`, `.env.test` blanks the Razorpay key and the egress barrier refuses every
 * non-loopback host, so the application's own `razorpayService` runs its dev mock. This preload
 * changes exactly three things, and only after proving it is safe to:
 *
 *  1. it copies RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET from `apps/backend/.env` into the process —
 *     REFUSING unless the key id starts with `rzp_test_` (a live key is never loaded);
 *  2. it sets HOMIGO_REQUIRE_RAZORPAY=1 so the existing service uses that key (no second client);
 *  3. it replaces the blanket egress barrier with a narrower one: `api.razorpay.com` and loopback
 *     only. Every other provider stays blanked by its own `liveProviderAllowed` flag.
 *
 * It refuses outright unless the database name contains "test". Every destination the process
 * reaches is appended to RAZORPAY_TEST_EGRESS_LOG when that is set.
 */
// load-env first: it applies .env.test (which blanks the key) — this preload must run after it.
import "../../load-env";
import { appendFileSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parse } from "dotenv";

function refuse(why: string): never {
  throw new Error(`[razorpay-test-mode] REFUSING: ${why}`);
}

if (process.env.HOMIGO_RAZORPAY_TEST_MODE !== "1") refuse("HOMIGO_RAZORPAY_TEST_MODE=1 is required");
if (process.env.NODE_ENV !== "test") refuse(`NODE_ENV is "${process.env.NODE_ENV}", not "test"`);

const dbName = (process.env.DATABASE_URL ?? "").split("/").pop()?.split("?")[0] ?? "";
if (!/test/i.test(dbName)) refuse(`database "${dbName}" is not a test database`);

// HOMIGO_RAZORPAY_TEST_ENV_FILE lets an isolated source copy (which never holds a .env) read the key.
const envFile = process.env.HOMIGO_RAZORPAY_TEST_ENV_FILE || resolve(import.meta.dir, "../../../.env");
const dotenv = parse(readFileSync(envFile));
const keyId = dotenv.RAZORPAY_KEY_ID ?? "";
const keySecret = dotenv.RAZORPAY_KEY_SECRET ?? "";
if (!keyId.startsWith("rzp_test_")) refuse("the key in apps/backend/.env is not a rzp_test_ key");
if (!keySecret) refuse("no RAZORPAY_KEY_SECRET in apps/backend/.env");
for (const [k, v] of Object.entries(process.env)) {
  if (typeof v === "string" && v.includes("rzp_live_")) refuse(`${k} carries a rzp_live_ value`);
}

process.env.RAZORPAY_KEY_ID = keyId;
process.env.RAZORPAY_KEY_SECRET = keySecret;
process.env.HOMIGO_REQUIRE_RAZORPAY = "1";
// The blanket barrier (no-external-egress.ts) is still installed; it defers to this flag. The
// narrower barrier below is what actually decides.
process.env.HOMIGO_ALLOW_EXTERNAL = "1";

const ALLOWED = new Set(["api.razorpay.com"]);
const LOOPBACK = /^(localhost|127\.\d+\.\d+\.\d+|::1|\[::1\]|0\.0\.0\.0|::ffff:127\.\d+\.\d+\.\d+|host\.docker\.internal)$/i;
const log = process.env.RAZORPAY_TEST_EGRESS_LOG;

const innerFetch = globalThis.fetch;
globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    host = "<unparsed>";
  }
  if (log) appendFileSync(log, `fetch\t${host}\t${(init?.method ?? "GET").toUpperCase()}\n`);
  if (!ALLOWED.has(host) && !LOOPBACK.test(host)) {
    return Promise.reject(new Error(`EGRESS_BLOCKED (razorpay-test-mode): ${host}`));
  }
  return innerFetch(input, init);
}) as typeof fetch;

if (log) appendFileSync(log, `preload\tloaded\t${keyId.slice(0, 9)}\n`);
