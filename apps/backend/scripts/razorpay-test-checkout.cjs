/**
 * Completes ONE Razorpay TEST-MODE checkout in a headless browser, the way a customer's browser does:
 * Razorpay's own checkout.js, opened on an order the APPLICATION created, paid with Razorpay's TEST
 * netbanking demo bank ("Success"). Prints the handler response — razorpay_payment_id, order id and
 * the signature Razorpay computed — as one JSON line on stdout.
 *
 *   node scripts/razorpay-test-checkout.cjs <rzp_test_key_id> <order_id> [--fail]
 *
 * Refuses any key that is not `rzp_test_`. Only the public key id is needed; the secret never leaves
 * the backend. Used by src/__tests__/razorpay-test-mode.real.test.ts.
 */
const path = require("path");
const fs = require("fs");

const [keyId, orderId, ...flags] = process.argv.slice(2);
if (!/^rzp_test_/.test(keyId || "")) {
  console.error("REFUSING: the key id is not a rzp_test_ key");
  process.exit(2);
}
if (!/^order_/.test(orderId || "") || orderId.startsWith("order_dev_")) {
  console.error("REFUSING: not a Razorpay order id");
  process.exit(2);
}
const outcome = flags.includes("--fail") ? "Failure" : "Success";
const shots = process.env.RAZORPAY_CHECKOUT_SCREENSHOTS;

// Playwright is installed in the web apps, not the backend.
const here = __dirname;
const pw = require(require.resolve("playwright", { paths: [path.join(here, "../../web"), path.join(here, "../../admin-panel"), path.join(here, "../../..")] }));
const log = (...a) => console.error("[checkout]", ...a);

(async () => {
  const browser = await pw.chromium.launch({ headless: true });
  try {
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    const page = await ctx.newPage();
    await page.route("http://localhost:39999/pay", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: `<!doctype html><html><body>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script>
<script>
  window.__result = null;
  const rzp = new Razorpay({
    key: ${JSON.stringify(keyId)}, order_id: ${JSON.stringify(orderId)}, name: "Homeeigo TEST",
    prefill: { contact: "+919000090000", email: "rzp-test@homigo.test", method: "netbanking" },
    notes: { homigo_test: "razorpay-test-mode" },
    handler: (r) => { window.__result = { ok: true, ...r }; },
    modal: { ondismiss: () => { window.__result = window.__result || { ok: false, dismissed: true }; } },
  });
  rzp.on("payment.failed", (r) => { window.__result = { ok: false, error: r.error }; });
  rzp.open();
</script></body></html>`,
      }),
    );
    // Don't wait for the full load event: it includes Razorpay's external checkout.js and its trackers,
    // which occasionally take over 30 s. The checkout frame is waited for explicitly below.
    await page.goto("http://localhost:39999/pay", { waitUntil: "domcontentloaded", timeout: 60000 });
    const checkoutFrame = () => page.frames().find((f) => f.url().startsWith("https://api.razorpay.com/v1/checkout/public"));
    for (let i = 0; i < 80 && !checkoutFrame(); i++) await page.waitForTimeout(250);
    const f = checkoutFrame();
    if (!f) throw new Error("checkout frame never loaded");
    await f.waitForSelector("text=State Bank of India", { timeout: 30000 });
    await page.waitForTimeout(1000);
    if (shots) await page.screenshot({ path: path.join(shots, `${orderId}-1-methods.png`) });

    const popupP = ctx.waitForEvent("page", { timeout: 30000 }).catch(() => null);
    await f.locator("text=State Bank of India").first().click({ timeout: 10000 });
    await page.waitForTimeout(1200);
    const pay = f.locator("button:has-text('Pay')");
    if ((await pay.count()) && (await pay.last().isVisible().catch(() => false))) await pay.last().click({ timeout: 5000 }).catch(() => {});
    const bank = await popupP;
    if (!bank) throw new Error("demo bank page never opened");
    // The popup opens as about:blank and is navigated to the bank afterwards; how long that takes
    // varies run to run, so wait for the destination rather than a fixed delay.
    await bank.waitForURL(/\/gateway\/mocksharp\//, { timeout: 30000 }).catch(() => {});
    await bank.waitForLoadState("domcontentloaded").catch(() => {});
    await bank.waitForTimeout(500);
    const bankUrl = bank.url();
    // Razorpay's TEST demo bank lives under /gateway/mocksharp and is served only for rzp_test_ keys.
    if (!bankUrl.includes("/gateway/mocksharp/")) throw new Error(`not the Razorpay TEST demo bank: ${bankUrl.slice(0, 80)}`);
    if (shots) await bank.screenshot({ path: path.join(shots, `${orderId}-2-demo-bank.png`) });
    await bank.locator(`button:has-text('${outcome}'), input[value='${outcome}'], a:has-text('${outcome}')`).first().click({ timeout: 10000 });

    let result = null;
    for (let i = 0; i < 180 && !result; i++) {
      result = await page.evaluate(() => window.__result);
      if (!result) await page.waitForTimeout(500);
    }
    if (!result) throw new Error("checkout produced no result");
    process.stdout.write(`${JSON.stringify({ ...result, demoBank: bankUrl.split("?")[0] })}\n`);
  } finally {
    await browser.close();
  }
})().catch((e) => {
  log("FAILED", String(e && e.message ? e.message : e).split("\n")[0]);
  process.exit(1);
});
