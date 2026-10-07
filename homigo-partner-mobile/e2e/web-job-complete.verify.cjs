/**
 * Drives one job to completion through the partner app (exported for web) against an ISOLATED
 * backend: on the way → arrived → start with the customer's PIN → complete → the partner's
 * earning in the server's lines. The customer's PIN is read with the customer's own session, as
 * the customer would read it to the partner at the door.
 *
 *   node e2e/web-job-complete.verify.cjs <outDir> <seed.json>
 */
const fs = require("fs");
const path = require("path");
const { chromium, devices } = require("@playwright/test");

const OUT = process.argv[2];
const seed = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
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
  let tick = 0;
  const gps = setInterval(() => ctx.setGeolocation({ latitude: JOB.latitude + (tick++ % 2) * 0.00001, longitude: JOB.longitude, accuracy: 10 }).catch(() => {}), 8000);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => out.pageErrors.push(String(e).slice(0, 240)));
  page.on("console", (m) => {
    if (m.type() === "error" && !/sentry|pointerEvents|shadow\*|useNativeDriver|Failed to load resource/i.test(m.text())) out.pageErrors.push(`console: ${m.text().slice(0, 500)}`);
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
  const waitPost = (suffix) => page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/api/bookings/${ID}${suffix}`), { timeout: 60000 });
  const ctaText = async () => (await page.getByTestId("job-primary-cta").innerText().catch(() => "")).trim();
  const waitCta = (re) => page.waitForFunction((src) => new RegExp(src, "i").test(document.querySelector("[data-testid='job-primary-cta']")?.textContent ?? ""), re.source, { timeout: 40000 }).catch(() => {});

  try {
    // The customer's session, for the start PIN only.
    const login = await ctx.request.post(`${API}/api/auth/login`, { data: { email: seed.customer.email, password: seed.password } });
    const customerToken = (await login.json()).data?.accessToken ?? (await login.json()).data?.tokens?.accessToken;
    step("the customer's session is available to read the PIN", Boolean(customerToken), String(login.status()));

    await page.goto(`${APP}/login`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await page.getByTestId("partner-login-email").waitFor({ timeout: 90000 });
    await page.getByTestId("partner-login-email").fill(seed.partner.email);
    await page.getByTestId("partner-login-password").fill(seed.password);
    await page.getByTestId("partner-login-submit").click();
    await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60000 });
    await page.waitForTimeout(6000);

    await page.goto(`${APP}/job/${ID}`, { waitUntil: "domcontentloaded" });
    const cta = page.getByTestId("job-primary-cta");
    await cta.waitFor({ timeout: 60000 });
    const before = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    step("before completion the earning is not estimated: the screen says when it will be shown", /shown once it is completed/i.test(before) || (await page.getByTestId("job-earnings").count()) === 0, null);

    let res = waitPost("/en-route");
    await cta.click();
    step("on the way", (await res).status() === 200, null);
    await waitCta(/I've arrived/);

    let arrived = null;
    for (let i = 0; i < 12; i++) {
      res = waitPost("/arrived");
      await cta.click();
      arrived = await res;
      if (arrived.status() === 200) break;
      await page.waitForTimeout(5000);
    }
    step("arrived, from the position the server holds", arrived && arrived.status() === 200, arrived ? String(arrived.status()) : "none");
    await waitCta(/Start job/);

    // Start: the sheet sends the PIN to the customer; the customer reads it back.
    const otpSent = waitPost("/start-otp");
    await cta.click();
    step("the start PIN is sent to the customer when the sheet opens", (await otpSent).status() === 200, null);
    await shot("1-start-pin");
    const pinRes = await ctx.request.get(`${API}/api/bookings/${ID}/start-pin`, { headers: { authorization: `Bearer ${customerToken}` } });
    const pin = (await pinRes.json()).data?.pin ?? (await pinRes.json()).data?.otp;
    step("the customer can read the PIN in their own app", /^\d{4,8}$/.test(String(pin ?? "")), String(pinRes.status()));
    res = waitPost("/start");
    const input = page.locator("input[inputmode='numeric'], input[autocomplete='one-time-code'], input[type='tel'], input[type='text']").last();
    await input.fill(String(pin));
    const started = await res;
    step("the right PIN starts the job", started.status() === 200, String(started.status()));
    await waitCta(/Complete job/);
    step("the primary action moves to: Complete job", /Complete job/i.test(await ctaText()), await ctaText());
    const rail = (await page.getByTestId("job-stage-rail").innerText()).replace(/\s+/g, " ");
    step("the stage rail shows the start", /Started \d/.test(rail), rail.slice(0, 140));
    step("no-show is no longer offered once the job has started", (await page.getByTestId("no-show-section").count()) === 0, null);
    await shot("2-in-progress");

    res = waitPost("/complete");
    await cta.click();
    const done = await res;
    const doneBody = await done.json().catch(() => ({}));
    step("the job completes", done.status() === 200, `${done.status()} ${doneBody.code || ""} ${doneBody.error || ""}`.slice(0, 160));

    await page.getByTestId("job-earnings").waitFor({ timeout: 40000 });
    await page.waitForFunction(() => document.querySelector("[data-testid='job-earnings-net']"), null, { timeout: 30000 }).catch(() => {});
    const partnerAuth = await page.evaluate(() => {
      for (let i = 0; i < localStorage.length; i++) {
        const v = localStorage.getItem(localStorage.key(i));
        const m = v && v.match(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/);
        if (m) return m[0];
      }
      return null;
    });
    const shown = ((await page.getByTestId("job-earnings-net").innerText().catch(() => "")) || "").replace(/[^\d.]/g, "");
    let serverNet = null;
    if (partnerAuth) {
      const e = await ctx.request.get(`${API}/api/providers/me/bookings/${ID}/earning`, { headers: { authorization: `Bearer ${partnerAuth}` } });
      serverNet = (await e.json()).data?.earning?.net ?? null;
    }
    step("the completed job shows the partner's earning, net equal to the server's", shown !== "" && (serverNet == null || Number(shown) === Number(serverNet)), `shown ${shown}, server ${serverNet}`);
    const end = (await page.locator("body").innerText()).replace(/\s+/g, " ");
    step("a completed job has no live primary action and reads as completed", (await page.getByTestId("job-primary-cta").count()) === 0 && /Completed/.test(end), null);
    step("nothing on the completed job shows NaN or undefined", !/\bNaN\b|\bundefined\b/.test(end), null);
    await shot("3-completed");
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
