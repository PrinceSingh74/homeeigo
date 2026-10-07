/**
 * Drives one job through the partner app (exported for web) against an ISOLATED backend:
 * on the way → arrived (from the position the server holds) → "Customer not available?" →
 * report with no door photo → the server's result. It checks that what the screen says is what
 * the server answered.
 *
 *   node e2e/web-job-flow.verify.cjs <outDir> <seed.json> <backdate-arrival.ts>
 *
 * The third argument is a test-database helper that moves the arrival and the booked time into
 * the past (the 15-minute wait cannot be sat through here).
 */
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { chromium, devices } = require("@playwright/test");

const OUT = process.argv[2];
const seed = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
const BACKDATE = process.argv[4];
const APP = process.env.VERIFY_APP_URL || "http://localhost:8091";
const API = process.env.VERIFY_API_URL || "http://localhost:3100";
const ID = seed.partnerBookingId;
fs.mkdirSync(OUT, { recursive: true });

const out = { steps: [], pageErrors: [], calls: [] };
const step = (name, ok, detail) => out.steps.push({ name, ok: Boolean(ok), detail: detail ?? null });
const JOB = { latitude: 28.62, longitude: 77.37 };

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices["Pixel 7"], permissions: ["geolocation"], geolocation: { ...JOB, accuracy: 10 } });
  await ctx.route(/sentry\.io|ingest\.sentry|maps\.googleapis/, (r) => r.abort());
  // A real GPS gives a new reading every few seconds; a fixed one never yields a second.
  let tick = 0;
  const gps = setInterval(() => ctx.setGeolocation({ latitude: JOB.latitude + (tick++ % 2) * 0.00001, longitude: JOB.longitude, accuracy: 10 }).catch(() => {}), 8000);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => out.pageErrors.push(String(e).slice(0, 240)));
  // A render crash is caught by the app's error boundary and never reaches "pageerror": React logs it.
  page.on("console", (m) => {
    if (m.type() === "error" && !/sentry|pointerEvents|shadow\*|useNativeDriver/i.test(m.text())) out.pageErrors.push(`console: ${m.text().slice(0, 600)}`);
  });
  page.on("response", async (r) => {
    const m = r.request().method();
    if (m === "GET" || !r.url().startsWith(API)) return;
    const p = r.url().replace(API, "").replace(/\?.*/, "").replace(/c[a-z0-9]{24}/g, ":id");
    if (/heartbeat|location|push-token|vitals/.test(p)) return;
    let code = "";
    if (r.status() >= 400) code = (await r.json().catch(() => ({}))).code || "";
    out.calls.push(`${m} ${p} -> ${r.status()} ${code}`.trim());
  });
  // A request the browser never got an answer to (CORS, a dropped connection) has no "response".
  page.on("requestfailed", (r) => {
    if (r.method() !== "GET" && r.url().startsWith(API)) out.calls.push(`FAILED ${r.method()} ${r.url().replace(API, "").slice(0, 80)} ${(r.failure() || {}).errorText || ""}`);
  });
  const shot = (name) => page.screenshot({ path: path.join(OUT, `${name}.png`) }).catch(() => {});
  const bodyText = async () => (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
  const waitPost = (suffix) => page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/api/bookings/${ID}${suffix}`), { timeout: 60000 });

  try {
    await page.goto(`${APP}/login`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.getByTestId("partner-login-email").waitFor({ timeout: 90000 });
    await page.getByTestId("partner-login-email").fill(seed.partner.email);
    await page.getByTestId("partner-login-password").fill(seed.password);
    await page.getByTestId("partner-login-submit").click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 });
    await page.waitForTimeout(6000); // the first located heartbeat

    await page.goto(`${APP}/job/${ID}`, { waitUntil: "domcontentloaded" });
    const cta = page.getByTestId("job-primary-cta");
    await cta.waitFor({ timeout: 60000 });
    step("an accepted job offers one primary action: On my way", /On my way/i.test(await cta.innerText()), (await cta.innerText()).trim());
    step("no-show is not offered before arrival", (await page.getByTestId("no-show-section").count()) === 0, null);

    let res = waitPost("/en-route");
    await cta.click();
    step("on the way is recorded by the server", (await res).status() === 200, null);
    await page.waitForFunction(() => /I've arrived/i.test(document.querySelector("[data-testid='job-primary-cta']")?.textContent ?? ""), null, { timeout: 30000 }).catch(() => {});
    step("the primary action moves to: I've arrived", /I've arrived/i.test(await cta.innerText()), (await cta.innerText()).trim());
    await shot("1-en-route");

    // Arrive: the server must hold the device at the job; retry while the heartbeat lands.
    let arrived = null;
    for (let i = 0; i < 12; i++) {
      res = waitPost("/arrived");
      await cta.click();
      arrived = await res;
      if (arrived.status() === 200) break;
      const banner = await page.getByTestId("job-location-banner").innerText().catch(() => "");
      if (i === 0) step("a refused arrival shows the server's sentence in a banner that stays", banner.length > 20, banner.replace(/\s+/g, " ").slice(0, 140));
      await page.waitForTimeout(5000);
    }
    step("arrival is recorded from the position the server holds", arrived && arrived.status() === 200, arrived ? String(arrived.status()) : "none");
    await page.waitForFunction(() => /Start job/i.test(document.querySelector("[data-testid='job-primary-cta']")?.textContent ?? ""), null, { timeout: 30000 }).catch(() => {});
    step("the primary action moves to: Start job", /Start job/i.test(await cta.innerText()), (await cta.innerText()).trim());
    const rail = (await page.getByTestId("job-stage-rail").innerText()).replace(/\s+/g, " ");
    step("the stage rail shows the arrival", /Arrived/.test(rail), rail.slice(0, 120));
    await shot("2-arrived");

    // Customer not available: before the booked time the server says it cannot be reported yet.
    const toggle = page.getByTestId("no-show-toggle");
    await toggle.waitFor({ timeout: 30000 });
    const box = await toggle.boundingBox();
    step("the no-show control is a 48-pt secondary control, collapsed", box && box.height >= 44, box ? `${Math.round(box.height)}px` : "no box");
    await toggle.click();
    const before = (await page.getByTestId("no-show-message").innerText()).trim();
    step("before the booked time it shows the server's sentence and cannot be sent", /booked time has not come/i.test(before) && (await page.getByTestId("no-show-report").isDisabled().catch(() => true)), before.slice(0, 110));
    await shot("3-no-show-before");

    execFileSync("bun", ["run", BACKDATE, ID, "20"], { cwd: path.join(__dirname, "..", "..", "apps", "backend"), env: { ...process.env, NODE_ENV: "test" }, stdio: "pipe" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByTestId("no-show-toggle").waitFor({ timeout: 60000 });
    await page.getByTestId("no-show-toggle").click();
    await page.waitForFunction(() => !/booked time has not come/i.test(document.querySelector("[data-testid='no-show-message']")?.textContent ?? "x"), null, { timeout: 30000 }).catch(() => {});
    const after = (await page.getByTestId("no-show-message").innerText()).trim();
    step("after the wait, with no door photo, the server says no fee will be charged", /photo at the door/i.test(after) && /no fee/i.test(after), after.slice(0, 120));
    step("a door-photo control is offered", (await page.getByTestId("no-show-door-photo").count()) > 0, null);
    const report = page.getByTestId("no-show-report");
    await page.waitForFunction(() => {
      const el = document.querySelector("[data-testid='no-show-report']");
      return el && el.getAttribute("aria-disabled") !== "true" && !el.hasAttribute("disabled");
    }, null, { timeout: 30000 }).catch(() => {});
    await report.click();
    const confirm = page.getByTestId("no-show-confirm");
    await confirm.waitFor({ timeout: 15000 });
    const sheet = (await confirm.innerText()).replace(/\s+/g, " ");
    step("it asks first, in a sheet that repeats the server's sentence", sheet.includes(after.slice(0, 40)), sheet.slice(0, 120));
    await shot("4-no-show-confirm");
    res = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith(`/api/bookings/${ID}/no-show`), { timeout: 30000 });
    await confirm.getByRole("button", { name: /report customer not available/i }).last().click();
    const sent = await res;
    const body = await sent.json().catch(() => ({}));
    step("the no-show is recorded with no fee, and the server says why", sent.status() === 200 && body.data?.feeAmount === 0 && body.data?.feeWithheld === "NO_DOOR_PHOTO", `${sent.status()} fee ${body.data?.feeAmount} ${body.data?.feeWithheld}`);
    await page.getByTestId("no-show-result").waitFor({ timeout: 20000 });
    const result = (await page.getByTestId("no-show-result").innerText()).replace(/\s+/g, " ");
    step("the partner sees the server's result and the reason no fee was taken", /No fee was taken/i.test(result), result.slice(0, 160));
    await page.waitForTimeout(2500);
    const end = await bodyText();
    step("the job now reads as closed, with no live primary action", /Customer not available/i.test(end) && (await page.getByTestId("job-primary-cta").count()) === 0, null);
    await shot("5-no-show-result");
  } catch (e) {
    step("HARNESS STOPPED", false, String(e).slice(0, 500));
    await shot("zz-failure");
  }
  clearInterval(gps);
  out.pageErrors = [...new Set(out.pageErrors)];
  await browser.close();
  fs.writeFileSync(path.join(OUT, "result.json"), JSON.stringify(out, null, 1));
  const failed = out.steps.filter((s) => !s.ok);
  console.log(`steps ${out.steps.length - failed.length}/${out.steps.length}`);
  for (const s of out.steps) console.log(`${s.ok ? "ok  " : "FAIL"} ${s.name}${s.detail ? " :: " + s.detail : ""}`);
  console.log("calls:", JSON.stringify(out.calls));
  console.log("pageErrors:", JSON.stringify(out.pageErrors));
})();
