/**
 * Walks the partner app (exported for web) against an ISOLATED backend and records what each
 * screen really shows: a screenshot, the page errors, the API calls that were refused, and a few
 * facts that must hold on every screen (no "NaN", no "undefined", no raw error object).
 *
 * It is a look at the screens, not a device test: gestures, pickers, permissions and the keyboard
 * are the device scripts' business (e2e/native-android-*.ts).
 *
 *   # isolated backend on :3100 (test database), app exported with EXPO_PUBLIC_API_URL=http://localhost:3100
 *   npx --yes serve dist-e2e -l 8091 --single --no-port-switching
 *   node e2e/web-screens.verify.cjs <outDir> <seed.json>          # seed: apps/backend/scripts/browser-verify-seed.ts
 */
const fs = require("fs");
const path = require("path");
const { chromium, devices } = require("@playwright/test");

const OUT = process.argv[2];
const seed = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const APP = process.env.VERIFY_APP_URL || "http://localhost:8091";
const API = process.env.VERIFY_API_URL || "http://localhost:3100";
fs.mkdirSync(OUT, { recursive: true });

const out = { screens: [], steps: [], pageErrors: [], refused: [] };
const step = (name, ok, detail) => out.steps.push({ name, ok: Boolean(ok), detail: detail ?? null });

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices["Pixel 7"], permissions: ["geolocation"], geolocation: { latitude: 28.62, longitude: 77.37, accuracy: 10 } });
  await ctx.route(/sentry\.io|ingest\.sentry|maps\.googleapis|google-analytics/, (r) => r.abort());
  const page = await ctx.newPage();
  page.on("pageerror", (e) => out.pageErrors.push(String(e).slice(0, 240)));
  page.on("response", (r) => {
    if (r.url().startsWith(API) && r.status() >= 400 && !/\/auth\/refresh/.test(r.url())) {
      out.refused.push(`${r.status()} ${r.request().method()} ${r.url().replace(API, "").replace(/\?.*/, "").replace(/c[a-z0-9]{24}/g, ":id")}`);
    }
  });

  /** Screenshot a screen and check the facts every screen owes. */
  async function look(name, { settleMs = 2500 } = {}) {
    await page.waitForTimeout(settleMs);
    const text = (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
    const file = `${String(out.screens.length + 1).padStart(2, "0")}-${name}.png`;
    await page.screenshot({ path: path.join(OUT, file), fullPage: true }).catch(() => {});
    const bad = [/\bNaN\b/, /\bundefined\b/, /\[object Object\]/, /Something went wrong/i].filter((re) => re.test(text)).map(String);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth).catch(() => null);
    out.screens.push({ name, file, chars: text.length, bad, overflow, sample: text.slice(0, 220) });
    step(`${name}: renders content, no NaN / undefined / crash, no sideways scroll`, text.length > 40 && bad.length === 0 && (overflow ?? 0) <= 1, bad.length ? bad.join(" ") : `overflow ${overflow}`);
    return text;
  }
  const open = async (route) => {
    await page.goto(`${APP}${route}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  };

  try {
    await open("/login");
    await page.getByTestId("partner-login-email").waitFor({ timeout: 90000 });
    await look("login", { settleMs: 800 });
    await page.getByTestId("partner-login-email").fill(seed.partner.email);
    await page.getByTestId("partner-login-password").fill(seed.password);
    await page.getByTestId("partner-login-submit").click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 });
    step("the partner signs in", true, null);

    const home = await look("home", { settleMs: 5000 });
    step("home greets the partner and shows the online control", /Hello,/.test(home) && /Online|Offline|Paused/i.test(home), null);

    await open("/requests");
    const jobs = await look("jobs-list", { settleMs: 4000 });
    step("the jobs list has its filter and names a job", /New|Active|Completed/.test(jobs), null);

    await open(`/job/${seed.partnerBookingId}`);
    await page.getByTestId("job-detail-screen").waitFor({ timeout: 60000 }).catch(() => {});
    const job = await look("job-accepted", { settleMs: 5000 });
    step("the job screen shows the stage rail and one primary action", (await page.getByTestId("job-stage-rail").count()) > 0 && (await page.getByTestId("job-primary-cta").count()) > 0, null);
    step("the customer's price is not presented as the partner's pay", !/Your earning[^.]{0,40}₹/.test(job) || /shown once it is completed/i.test(job), null);

    for (const [name, route] of [
      ["wallet", "/wallet"],
      ["hq-menu", "/explore"],
      ["profile", "/profile"],
      ["hq-earnings", "/hq/earnings-hq"],
      ["hq-earnings-detail", "/hq/earnings-detail"],
      ["hq-withdrawals", "/hq/earnings-payouts"],
      ["hq-reviews", "/hq/performance-reviews"],
      ["hq-analytics", "/hq/performance-analytics"],
      ["hq-scorecard", "/hq/performance-scorecard"],
      ["hq-rankings", "/hq/performance-rankings"],
      ["hq-availability", "/hq/account-availability"],
      ["hq-notifications", "/hq/account-notifications"],
      ["hq-support", "/hq/account-support"],
      ["hq-documents", "/hq/trust-documents"],
      ["hq-compliance", "/hq/trust-compliance"],
      ["hq-sos", "/hq/wellbeing-sos"],
      ["hq-ai-assistant", "/hq/ai-assistant"],
      ["hq-demand", "/hq/ai-demand-forecast"],
      ["hq-territory", "/hq/territory-analytics"],
      ["hq-surge", "/hq/territory-heatmap"],
      ["hq-attendance", "/hq/work-attendance"],
      ["hq-work", "/hq/work-hq"],
      ["hq-schedule", "/hq/work-schedule"],
      ["hq-invoices", "/hq/account-invoices"],
      ["hq-incentives", "/hq/earnings-incentives"],
      ["hq-tax", "/hq/earnings-tax"],
      ["hq-outlook", "/hq/earnings-forecast"],
      ["hq-career", "/hq/performance-career"],
      ["hq-quality", "/hq/performance-quality"],
      ["hq-training", "/hq/academy-training"],
      ["hq-credentials", "/hq/academy-credentials"],
      ["hq-services", "/hq/academy-services"],
      ["hq-rewards", "/hq/rewards-hub"],
      ["hq-referrals", "/hq/rewards-referrals"],
      ["hq-account-profile", "/hq/account-profile"],
      ["hq-settings", "/hq/account-settings"],
      ["hq-membership", "/hq/account-membership"],
      ["hq-service-history", "/hq/work-service-history"],
    ]) {
      await open(route);
      await look(name, { settleMs: 3500 });
    }
  } catch (e) {
    step("HARNESS STOPPED", false, String(e).slice(0, 500));
    await page.screenshot({ path: path.join(OUT, "zz-failure.png"), fullPage: true }).catch(() => {});
  }
  out.refused = [...new Set(out.refused)];
  out.pageErrors = [...new Set(out.pageErrors)];
  await browser.close();
  fs.writeFileSync(path.join(OUT, "result.json"), JSON.stringify(out, null, 1));
  const failed = out.steps.filter((s) => !s.ok);
  console.log(`steps ${out.steps.length - failed.length}/${out.steps.length}`);
  for (const s of failed) console.log(`FAIL ${s.name} :: ${s.detail ?? ""}`);
  console.log("refused:", JSON.stringify(out.refused));
  console.log("pageErrors:", JSON.stringify(out.pageErrors));
})();
