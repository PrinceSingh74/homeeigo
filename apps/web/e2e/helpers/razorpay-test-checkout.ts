/**
 * Capture a Razorpay TEST payment via Orders API + Checkout.js (Playwright).
 * Prints JSON: { paymentId, orderId, status, amountPaise }
 */
import { chromium, type FrameLocator } from "playwright";
import { config } from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:http";
import { writeFileSync, mkdirSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BACKEND = join(HERE, "../../../backend");
config({ path: join(BACKEND, ".env") });

const KEY_ID = process.env.RAZORPAY_KEY_ID ?? "";
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET ?? "";
const amountPaise = Number(process.env.RZP_CHECKOUT_AMOUNT_PAISE ?? "10000");

if (!KEY_ID.startsWith("rzp_test_")) {
  console.error(JSON.stringify({ error: "NON_TEST_KEY" }));
  process.exit(1);
}

const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");

async function createOrder(): Promise<{ id: string; amount: number }> {
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      amount: amountPaise,
      currency: "INR",
      receipt: `homigo_cert_${Date.now()}`,
      notes: { purpose: "refund_cert" },
    }),
  });
  if (!res.ok) throw new Error(`order failed: ${await res.text()}`);
  return (await res.json()) as { id: string; amount: number };
}

function checkoutHtml(orderId: string, keyId: string): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Homigo Cert</title>
<script src="https://checkout.razorpay.com/v1/checkout.js"></script></head>
<body>
<button id="pay">Pay ₹${amountPaise / 100}</button>
<script>
document.getElementById('pay').onclick = function() {
  const rzp = new Razorpay({
    key: ${JSON.stringify(keyId)},
    order_id: ${JSON.stringify(orderId)},
    name: 'Homigo Cert',
    description: 'Refund certification',
    prefill: { email: 'cert@homigo.test', contact: '9812345678' },
    theme: { color: '#3399cc' },
    handler: function(res) {
      window.__rzp = res;
      document.body.setAttribute('data-status', 'paid');
    },
    modal: { ondismiss: function() { document.body.setAttribute('data-status', 'dismissed'); } }
  });
  rzp.open();
};
</script></body></html>`;
}

async function serveCheckout(orderId: string): Promise<{ url: string; close: () => void }> {
  const dir = join(BACKEND, "docs", ".rzp-checkout-tmp");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, "checkout.html");
  writeFileSync(file, checkoutHtml(orderId, KEY_ID));
  return new Promise((resolve) => {
    const server = createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(checkoutHtml(orderId, KEY_ID));
    });
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}/`,
        close: () => server.close(),
      });
    });
  });
}

async function fillCardInRazorpayFrame(page: import("playwright").Page): Promise<boolean> {
  const frame = page.frame({ url: /razorpay\.com/ });
  if (!frame) return false;
  return frame.evaluate(`
    (() => {
      const inputs = Array.from(document.querySelectorAll("input")).filter(
        (i) => !["radio", "checkbox", "hidden"].includes(i.type),
      );
      if (inputs.length < 3) return false;
      const set = (el, value) => {
        el.focus();
        el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      };
      set(inputs[0], "5555555555554444");
      set(inputs[1], "12 / 30");
      set(inputs[2], "123");
      if (inputs[3]) set(inputs[3], "Homigo Cert");
      return true;
    })()
  `);
}

async function completeCheckout(pageUrl: string): Promise<{ orderId: string; paymentId: string }> {
  const order = await createOrder();
  const server = await serveCheckout(order.id);
  const browser = await chromium.launch({ headless: true, timeout: 120_000 });
  const page = await browser.newPage();
  try {
    await page.goto(server.url, { waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: /pay/i }).click();
    await page.waitForTimeout(2500);

    const checkout = page.frameLocator("iframe.razorpay-checkout-frame");
    await checkout.getByText(/^upi$/i).first().click({ timeout: 10_000 });
    await page.waitForTimeout(1500);

    const vpa = checkout
      .getByPlaceholder(/vpa|upi|example@/i)
      .or(checkout.locator('input[name="vpa"], input[inputmode="text"]'))
      .first();
    if (await vpa.isVisible({ timeout: 5000 }).catch(() => false)) {
      await vpa.fill("success@razorpay");
    } else {
      await checkout.getByText(/^cards$/i).first().click({ timeout: 5000 });
      await page.waitForTimeout(1000);
      if (!(await fillCardInRazorpayFrame(page))) {
        await page.screenshot({ path: join(BACKEND, "docs/rzp-checkout-debug.png"), fullPage: true });
        throw new Error("CARD_FIELDS_NOT_FOUND");
      }
    }

    const continueBtn = checkout.getByRole("button", { name: /continue|pay|verify/i });
    await continueBtn.first().waitFor({ state: "visible", timeout: 10_000 });
    await continueBtn.first().click({ timeout: 10_000, force: true });
    await page.waitForTimeout(4000);

    for (let attempt = 0; attempt < 12; attempt++) {
      for (const frame of page.frames()) {
        for (const loc of [
          frame.getByRole("button", { name: /^success$/i }),
          frame.getByText(/^success$/i),
          frame.locator('button:has-text("Success")'),
        ]) {
          if (await loc.first().isVisible({ timeout: 1500 }).catch(() => false)) {
            await loc.first().click({ force: true }).catch(() => undefined);
            break;
          }
        }
      }
      await page.waitForTimeout(2000);
      const handler = await page
        .evaluate(() => (window as unknown as { __rzp?: { razorpay_payment_id: string } }).__rzp)
        .catch(() => null);
      if (handler?.razorpay_payment_id) {
        return { orderId: order.id, paymentId: handler.razorpay_payment_id };
      }
      const orderPayRes = await fetch(`https://api.razorpay.com/v1/orders/${order.id}/payments`, {
        headers: { Authorization: `Basic ${auth}` },
      });
      if (orderPayRes.ok) {
        const data = (await orderPayRes.json()) as { items?: Array<{ id: string; status: string }> };
        const captured = data.items?.find((p) => p.status === "captured");
        if (captured) return { orderId: order.id, paymentId: captured.id };
      }
    }
    await page.screenshot({ path: join(BACKEND, "docs/rzp-checkout-debug.png"), fullPage: true });
    throw new Error("PAYMENT_NOT_CAPTURED");
  } finally {
    await browser.close();
    server.close();
  }
}

async function main() {
  const { orderId, paymentId } = await completeCheckout("");
  const payRes = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  const pay = (await payRes.json()) as { id: string; status: string; amount: number };
  console.log(
    JSON.stringify({
      paymentId: pay.id,
      orderId,
      status: pay.status,
      amountPaise: pay.amount,
    }),
  );
}

main().catch((e) => {
  console.error(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  process.exit(1);
});
