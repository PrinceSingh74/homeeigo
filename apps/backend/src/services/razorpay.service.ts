import crypto from "crypto";

const KEY_ID = process.env.RAZORPAY_KEY_ID || "";
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "";

export class RazorpayService {
  get isConfigured() {
    return Boolean(KEY_ID && KEY_SECRET);
  }

  get keyId() {
    return KEY_ID;
  }

  async createOrder(amountInr: number, receipt: string, notes?: Record<string, string>) {
    const amountPaise = Math.round(amountInr * 100);
    if (this.isConfigured) {
      const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
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
      const data = (await res.json()) as { id: string; amount: number; currency: string };
      return { orderId: data.id, amount: data.amount, currency: data.currency };
    }
    if (process.env.NODE_ENV === "production") {
      throw new Error("Razorpay is not configured");
    }
    const orderId = `order_dev_${crypto.randomBytes(8).toString("hex")}`;
    return { orderId, amount: amountPaise, currency: "INR" };
  }

  verifyPaymentSignature(orderId: string, paymentId: string, signature: string): boolean {
    if (!KEY_SECRET) {
      return process.env.NODE_ENV !== "production";
    }
    const body = `${orderId}|${paymentId}`;
    const expected = crypto.createHmac("sha256", KEY_SECRET).update(body).digest("hex");
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

  async createPayout(referenceId: string, amountInr: number, account: { name: string; ifsc: string; number: string }) {
    if (!this.isConfigured) {
      throw new Error("Razorpay is not configured — payouts require live credentials");
    }
    // RazorpayX composite payout — requires fund account setup in dashboard.
    const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
    const res = await fetch("https://api.razorpay.com/v1/payouts", {
      method: "POST",
      headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        account_number: process.env.RAZORPAY_ACCOUNT_NUMBER || "",
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
    if (!res.ok) throw new Error("Refund failed");
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
