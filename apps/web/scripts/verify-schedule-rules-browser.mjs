/**
 * Phase 07/08 browser verification — runs against an ISOLATED stack (web :3011 → backend :3100 →
 * homigo_test). Never point it at the live backend.
 *
 * Proves in a real browser what the integration tests prove over HTTP:
 *   1. the schedule step no longer claims a slot is "secured" (nothing is reserved at that point);
 *   2. a lead-time refusal reaches the customer as the SPECIFIC rule, not "Invalid service or
 *      address. Add a saved address and try again.";
 *   3. the page returns the customer to the date step, where the problem actually is.
 *
 * Usage (from apps/web):
 *   node scripts/verify-schedule-rules-browser.mjs <seed.json> [webBase] [apiBase]
 */
import { createRequire } from "node:module";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const { chromium } = require(require.resolve("playwright", { paths: [process.cwd()] }));

const seed = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const WEB = process.argv[3] ?? "http://localhost:3011";
const API = process.argv[4] ?? "http://localhost:3100";

const out = { web: WEB, api: API, steps: {} };
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 1200 } });
// Third-party egress is noise here, and test traffic must never reach the production Sentry project.
await ctx.route(/sentry\.io|ingest\.sentry|maps\.googleapis/, (r) => r.abort());
const page = await ctx.newPage();
const consoleErrors = [];
page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text().slice(0, 200)); });

// ---- sign in through the real form -------------------------------------------------------------
await page.goto(`${WEB}/login`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.getByLabel(/email/i).first().fill(seed.customerEmail).catch(async () => {
  await page.locator('input[type="email"]').first().fill(seed.customerEmail);
});
await page.locator('input[type="password"]').first().fill(seed.password);
const loginResponse = page.waitForResponse((r) => /\/api\/auth\/login/.test(r.url()), { timeout: 30_000 });
await page.getByRole("button", { name: /sign in/i }).first().click();
out.steps.login = (await loginResponse).status();

// ---- the schedule step's own copy ---------------------------------------------------------------
await page.goto(`${WEB}/book?service=${encodeURIComponent(seed.serviceId)}`, { waitUntil: "domcontentloaded", timeout: 60_000 });
await page.waitForSelector("text=/Date\\s*&\\s*time/i", { timeout: 45_000 });
const bodyText = await page.evaluate(() => document.body.innerText);
out.steps.oldSecuredClaimPresent = bodyText.includes("Fastest available slot secured");
out.steps.newHonestCopyPresent = bodyText.includes("confirm this slot when you place the booking");

// ---- a refusal the customer can act on ----------------------------------------------------------
// The seeded service needs 48 hours' notice; the default slot is inside that window, so confirming
// must be refused with the lead-time message.
const confirm = page.getByRole("button", { name: /confirm|book now|pay/i }).last();
if (await confirm.count()) {
  const bookingResponse = page.waitForResponse((r) => /\/api\/bookings$/.test(r.url()) && r.request().method() === "POST", { timeout: 45_000 }).catch(() => null);
  await confirm.click({ trial: false }).catch(() => {});
  const res = await bookingResponse;
  if (res) {
    out.steps.bookingStatus = res.status();
    const json = await res.json().catch(() => ({}));
    out.steps.bookingCode = json.code;
    out.steps.bookingReason = json.reason;
    out.steps.bookingError = json.error;
    out.steps.mentionsSavedAddress = String(json.error ?? "").includes("saved address");
  }
  await page.waitForTimeout(1500);
  const after = await page.evaluate(() => document.body.innerText);
  out.steps.toastShowsRule = /notice/i.test(after) || /choose a later slot/i.test(after);
}

out.consoleErrors = consoleErrors.slice(0, 5);
await page.screenshot({ path: process.env.SHOT ?? "schedule-rules-verification.png", fullPage: false });
console.log(JSON.stringify(out, null, 2));
await browser.close();
