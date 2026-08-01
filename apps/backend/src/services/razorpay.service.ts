import crypto from "crypto";
import { razorpayBreaker } from "./../lib/circuit-breaker";
import { logger } from "../lib/logger";

const KEY_ID = process.env.RAZORPAY_KEY_ID || "";
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "";

let createOrderInvocationCount = 0;

/** Test/diagnostic counter — increments on every createOrder entry (dev or live). */
export function getRazorpayCreateOrderInvocationCount(): number {
  return createOrderInvocationCount;
}

export function resetRazorpayCreateOrderInvocationCount(): void {
  createOrderInvocationCount = 0;
}

export class RazorpayService {
  get isConfigured() {
    return Boolean(KEY_ID && KEY_SECRET);
  }

  get keyId() {
    return KEY_ID;
  }

  /** Dev fallback orders are not valid on the live Razorpay gateway. */
  isDevOrder(orderId: string) {
    return orderId.startsWith("order_dev_");
  }

  checkoutModeForOrder(orderId: string): "razorpay" | "dev_mock" {
    return this.isDevOrder(orderId) ? "dev_mock" : "razorpay";
  }

  async createOrder(amountInr: number, receipt: string, notes?: Record<string, string>) {
    createOrderInvocationCount += 1;
    const invocation = createOrderInvocationCount;
    const amountPaise = Math.round(amountInr * 100);
    if (this.isConfigured) {
      const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
      // Circuit breaker: isolate a failing Razorpay gateway so order creation fast-fails
      // (and the caller can surface a retry) instead of hanging the payment path.
      const data = await razorpayBreaker.execute(async () => {
        const res = await fetch("https://api.razorpay.com/v1/orders", {
          method: "POST",
          headers: {
            Authorization: `Basic ${auth}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            amount: amountPaise,
            currency: "INR",
            receipt,
            notes,
          }),
        });
        if (!res.ok) {
          const err = await res.text();
          throw new Error(`Razorpay order failed: ${err}`);
        }
        return (await res.json()) as { id: string; amount: number; currency: string };
      });
      logger.info("razorpay.gateway_order.created", {
        receipt,
        amountInr,
        amountPaise,
        orderId: data.id,
        mode: "live",
        invocation,
      });
      return { orderId: data.id, amount: data.amount, currency: data.currency };
    }
    if (process.env.NODE_ENV === "production") {
      throw new Error("Razorpay is not configured");
    }
    const orderId = `order_dev_${crypto.randomBytes(8).toString("hex")}`;
    logger.info("razorpay.gateway_order.created", {
      receipt,
      amountInr,
      amountPaise,
      orderId,
      mode: "dev",
      invocation,
    });
    return { orderId, amount: amountPaise, currency: "INR" };
  }

  /** HMAC for Razorpay checkout callback — used by verify and E2E mock signing. */
  computePaymentSignature(orderId: string, paymentId: string): string {
    if (!KEY_SECRET) return "dev_unsigned";
    const body = `${orderId}|${paymentId}`;
    return crypto.createHmac("sha256", KEY_SECRET).update(body).digest("hex");
  }

  verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
    if (!KEY_SECRET) {
      return process.env.NODE_ENV !== "production";
    }
    const expected = this.computePaymentSignature(orderId, paymentId);
    return safeEqual(expected, signature);
  }

  verifyWebhookSignature(rawBody: string, signature: string): boolean {
    if (!WEBHOOK_SECRET) return false;
    if (!signature) return false;
    const expected = crypto.createHmac("sha256", WEBHOOK_SECRET).update(rawBody).digest("hex");
    return safeEqual(expected, signature);
  }

  get isWebhookConfigured(): boolean {
    return Boolean(WEBHOOK_SECRET);
  }

  async fetchOrderPayments(orderId: string): Promise<Array<{ id: string; status: string; amount?: number }>> {
    if (!this.isConfigured) return [];
    const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
    const res = await fetch(`https://api.razorpay.com/v1/orders/${orderId}/payments`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: Array<{ id: string; status: string; amount?: number }> };
    return data.items ?? [];
  }

  async fetchPayments(count = 100, from?: number, to?: number): Promise<Array<{
    id: string;
    order_id?: string;
    status: string;
    amount: number;
  }>> {
    if (!this.isConfigured) return [];
    const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
    const params = new URLSearchParams({ count: String(count) });
    if (from) params.set("from", String(from));
    if (to) params.set("to", String(to));
    const res = await fetch(`https://api.razorpay.com/v1/payments?${params}`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      items?: Array<{ id: string; order_id?: string; status: string; amount: number }>;
    };
    return data.items ?? [];
  }

  async fetchRefunds(count = 100): Promise<Array<{ id: string; payment_id: string; amount: number; status: string }>> {
    if (!this.isConfigured) return [];
    const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
    const res = await fetch(`https://api.razorpay.com/v1/refunds?count=${count}`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      items?: Array<{ id: string; payment_id: string; amount: number; status: string }>;
    };
    return data.items ?? [];
  }

  async fetchSettlements(count = 100): Promise<Array<{
    id: string;
    amount: number;
    fees?: number;
    tax?: number;
    status?: string;
    created_at?: number;
  }>> {
    if (!this.isConfigured) return [];
    const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
    const res = await fetch(`https://api.razorpay.com/v1/settlements?count=${count}`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      items?: Array<{ id: string; amount: number; fees?: number; tax?: number; status?: string; created_at?: number }>;
    };
    return data.items ?? [];
  }

  async fetchSettlement(settlementId: string): Promise<{
    id: string;
    amount: number;
    fees?: number;
    tax?: number;
    payments?: Array<{ id: string; amount?: number }>;
  } | null> {
    if (!this.isConfigured) return null;
    const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
    const res = await fetch(`https://api.razorpay.com/v1/settlements/${settlementId}`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      id: string;
      amount: number;
      fees?: number;
      tax?: number;
      payments?: Array<{ id: string; amount?: number }>;
    };
    return data;
  }

  private authHeader(): string {
    return `Basic ${Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64")}`;
  }

  async fetchBalance(): Promise<{ balancePaise: number; refundCreditsPaise: number }> {
    if (!this.isConfigured) throw new Error("Razorpay is not configured");
    const res = await fetch("https://api.razorpay.com/v1/balance", {
      headers: { Authorization: this.authHeader() },
    });
    if (!res.ok) throw new Error(`balance fetch failed: ${await res.text()}`);
    const data = (await res.json()) as { balance?: number; refund_credits?: number };
    return { balancePaise: data.balance ?? 0, refundCreditsPaise: data.refund_credits ?? 0 };
  }

  /** Pre-flight RazorpayX validation before live payouts. */
  async validateRazorpayXPreflight(accountNumber: string): Promise<{
    ok: boolean;
    error?: string;
    balancePaise?: number;
    fundAccountsReachable?: boolean;
  }> {
    if (!this.isConfigured) {
      return { ok: false, error: "RAZORPAY_KEY_ID/SECRET not configured" };
    }
    if (!accountNumber.trim()) {
      return { ok: false, error: "RAZORPAY_ACCOUNT_NUMBER is empty" };
    }

    let balancePaise = 0;
    try {
      const balance = await this.fetchBalance();
      balancePaise = balance.balancePaise;
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    const faRes = await fetch("https://api.razorpay.com/v1/fund_accounts?count=1", {
      headers: { Authorization: this.authHeader() },
    });
    if (faRes.status === 401 || faRes.status === 403) {
      return {
        ok: false,
        error: `RazorpayX fund account API denied (${faRes.status}) — RazorpayX may not be enabled on this key`,
        balancePaise,
      };
    }
    if (!faRes.ok) {
      return {
        ok: false,
        error: `fund_accounts API failed: ${(await faRes.text()).slice(0, 200)}`,
        balancePaise,
      };
    }

    const payoutsProbe = await fetch("https://api.razorpay.com/v1/payouts?count=1", {
      headers: { Authorization: this.authHeader() },
    });
    if (payoutsProbe.status === 404 || payoutsProbe.status === 400) {
      const body = await payoutsProbe.text();
      return {
        ok: false,
        error: `Payouts API not available (${payoutsProbe.status}): ${body.slice(0, 200)} — enable RazorpayX payouts on this merchant or use live keys`,
        balancePaise,
        fundAccountsReachable: true,
      };
    }

    return { ok: true, balancePaise, fundAccountsReachable: true };
  }

  async fetchPayout(payoutId: string): Promise<{ id: string; status: string; amount?: number; utr?: string } | null> {
    if (!this.isConfigured) return null;
    const res = await fetch(`https://api.razorpay.com/v1/payouts/${payoutId}`, {
      headers: { Authorization: this.authHeader() },
    });
    if (!res.ok) return null;
    return (await res.json()) as { id: string; status: string; amount?: number; utr?: string };
  }

  async createPayout(referenceId: string, amountInr: number, account: { name: string; ifsc: string; number: string }) {
    if (!this.isConfigured) {
      throw new Error("Razorpay is not configured — payouts require live credentials");
    }
    const accountNumber = process.env.RAZORPAY_ACCOUNT_NUMBER?.trim();
    if (!accountNumber) {
      throw new Error("RAZORPAY_ACCOUNT_NUMBER is not configured — RazorpayX payout source account required");
    }
    // RazorpayX composite payout — requires fund account setup in dashboard.
    const res = await fetch("https://api.razorpay.com/v1/payouts", {
      method: "POST",
      headers: { Authorization: this.authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({
        account_number: accountNumber,
        amount: Math.round(amountInr * 100),
        currency: "INR",
        mode: "IMPS",
        purpose: "payout",
        fund_account: {
          account_type: "bank_account",
          bank_account: {
            name: account.name,
            ifsc: account.ifsc,
            account_number: account.number,
          },
          contact: {
            name: account.name,
            email: "payouts@homigo.demo",
            contact: "9999999999",
            type: "vendor",
            reference_id: referenceId,
          },
        },
        reference_id: referenceId,
      }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Razorpay payout failed: ${err}`);
    }
    const data = (await res.json()) as { id: string; status: string };
    return { payoutId: data.id, status: data.status };
  }

  async createRefund(paymentId: string, amountInr: number) {
    if (!this.isConfigured) {
      if (process.env.NODE_ENV === "production") throw new Error("Razorpay is not configured");
      return { refundId: `rfnd_dev_${crypto.randomBytes(6).toString("hex")}`, status: "processing" };
    }
    const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
    const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refund`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ amount: Math.round(amountInr * 100) }),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Refund failed: ${err}`);
    }
    const data = (await res.json()) as { id: string; status: string };
    return { refundId: data.id, status: data.status };
  }
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export const razorpayService = new RazorpayService();
