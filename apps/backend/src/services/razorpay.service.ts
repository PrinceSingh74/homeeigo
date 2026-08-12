import crypto from "crypto";
import { razorpayBreaker } from "./../lib/circuit-breaker";
import { logger } from "../lib/logger";

const KEY_ID = process.env.RAZORPAY_KEY_ID || "";
const KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";
const WEBHOOK_SECRET = process.env.RAZORPAY_WEBHOOK_SECRET || "";

/** What is actually known about a gateway refund attempt. */
export type GatewayRefundOutcome =
  /** Razorpay confirmed the refund and named it. */
  | { kind: "SUCCESS"; refundId: string; status: string }
  /** Razorpay answered with a decision (4xx). Nothing was created. */
  | { kind: "REJECTED"; httpStatus: number; detail: string }
  /** HTTP 409 — the idempotency key is already held by Razorpay, processed or in flight. */
  | { kind: "ALREADY_SUBMITTED"; detail: string }
  /** The request may or may not have been applied. Only reconciliation can settle it. */
  | { kind: "INDETERMINATE"; reason: string; detail?: string };

export type GatewayRefundRecord = {
  id: string;
  payment_id?: string;
  amount?: number;
  status?: string;
  notes?: Record<string, string>;
};

/**
 * Razorpay requires an idempotency key of at least 10 characters, alphanumerics, hyphens and
 * underscores only. Our internal operation keys carry colons (`ai-approval:<uuid>`,
 * `refund:<paymentId>:<amount>:…`), so they are hashed rather than sanitised: a hash is
 * deterministic, stable across a reconciliation that happens days later, and cannot produce an
 * illegal character or a collision between two operations that merely sanitise to the same text.
 */
function gatewayIdempotencyKey(operationKey: string): string {
  return `rfnd_${crypto.createHash("sha256").update(operationKey).digest("hex").slice(0, 40)}`;
}

/**
 * Whether a transport failure could have left the refund applied at the far end.
 *
 * The question is not "did this fail" but "was the request possibly delivered". A refused
 * connection or an unresolvable host means nothing ever left this process, and calling that
 * INDETERMINATE would freeze payments for what is really a local misconfiguration. A reset
 * socket or an elapsed deadline means bytes were already on the wire, and calling that FAILED
 * is what causes double refunds.
 *
 * Anything unrecognised is treated as ambiguous. Preserving uncertainty is the safe default;
 * asserting a failure we cannot prove is not.
 */
function classifyTransportFailure(err: unknown): GatewayRefundOutcome {
  const e = err as { name?: string; message?: string; code?: string; cause?: { code?: string; message?: string } };
  const code = e?.code ?? e?.cause?.code ?? "";
  const text = `${e?.name ?? ""} ${e?.message ?? ""} ${e?.cause?.message ?? ""}`.toLowerCase();

  // Connection never established — the request cannot have been received.
  const NEVER_SENT = [
    "ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH", "ENETUNREACH",
    "UND_ERR_CONNECT_TIMEOUT", "ERR_TLS_CERT_ALTNAME_INVALID", "DEPTH_ZERO_SELF_SIGNED_CERT",
    "UNABLE_TO_VERIFY_LEAF_SIGNATURE", "CERT_HAS_EXPIRED",
  ];
  if (NEVER_SENT.includes(code)) {
    return { kind: "REJECTED", httpStatus: 0, detail: `transport: ${code} (request never left the client)` };
  }

  // Sent, or possibly sent, with no usable answer.
  const MAYBE_SENT = [
    "ETIMEDOUT", "ECONNRESET", "ECONNABORTED", "EPIPE",
    "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "UND_ERR_SOCKET", "UND_ERR_RESPONSE",
  ];
  if (MAYBE_SENT.includes(code) || e?.name === "AbortError" || text.includes("socket hang up") || text.includes("aborted")) {
    return { kind: "INDETERMINATE", reason: code || e?.name || "TRANSPORT_FAULT", detail: text.trim().slice(0, 300) };
  }

  return { kind: "INDETERMINATE", reason: code || "UNKNOWN_TRANSPORT_FAULT", detail: text.trim().slice(0, 300) };
}

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

  /**
   * Executes a gateway refund and reports what is actually known about the outcome.
   *
   * The distinction this returns is the whole point. A refund call can end three ways, and the
   * old contract — throw on anything that is not a 2xx — collapsed two of them into one. A
   * definite rejection ("already fully refunded") and a lost response are both "an exception was
   * raised", and treating the second as the first is how one refund becomes two: the caller
   * reverts its state, an operator reads "failed", and the refund is issued again next to one
   * that may already exist.
   *
   * Idempotency uses Razorpay's own documented mechanism rather than an invented one. The
   * `X-Refund-Idempotency` header makes the gateway itself reject a duplicate, which is the only
   * place the guarantee can be absolute — our database cannot know what Razorpay already did.
   * Razorpay answers a reused key with HTTP 409, and that 409 is *good news*: it proves a refund
   * for this operation already exists there. It is reported as ALREADY_SUBMITTED, never as a
   * failure.
   */
  async executeGatewayRefund(opts: {
    paymentId: string;
    amountInr: number;
    /** Stable operation identity. Sent to Razorpay as its idempotency key and echoed in notes. */
    operationKey?: string;
    timeoutMs?: number;
  }): Promise<GatewayRefundOutcome> {
    if (!this.isConfigured) {
      if (process.env.NODE_ENV === "production") throw new Error("Razorpay is not configured");
      return {
        kind: "SUCCESS",
        refundId: `rfnd_dev_${crypto.randomBytes(6).toString("hex")}`,
        status: "processing",
      };
    }

    const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
    const headers: Record<string, string> = {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    };
    if (opts.operationKey) headers["X-Refund-Idempotency"] = gatewayIdempotencyKey(opts.operationKey);

    const body: Record<string, unknown> = { amount: Math.round(opts.amountInr * 100) };
    // Notes ride along so a refund found at the gateway during reconciliation can be traced back
    // to the operation that created it, without adding a column or a table on our side.
    if (opts.operationKey) body.notes = { homigo_operation: opts.operationKey.slice(0, 256) };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 30_000);

    let res: Response;
    try {
      res = await fetch(`https://api.razorpay.com/v1/payments/${opts.paymentId}/refund`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      return classifyTransportFailure(err);
    } finally {
      clearTimeout(timer);
    }

    if (res.status === 409) {
      // Documented as "already been processed" / "still in progress". Either way the gateway is
      // holding a refund for this key, so the outcome is not ours to declare — reconcile it.
      const detail = await res.text().catch(() => "");
      return { kind: "ALREADY_SUBMITTED", detail: detail.slice(0, 500) };
    }

    if (res.status >= 500) {
      // The server answered, but a 502/503/504 is an upstream that did not answer in time. The
      // refund may well have been created behind it.
      const detail = await res.text().catch(() => "");
      return { kind: "INDETERMINATE", reason: `HTTP_${res.status}`, detail: detail.slice(0, 500) };
    }

    if (!res.ok) {
      // A 4xx is Razorpay stating a decision. Nothing was created.
      const detail = await res.text().catch(() => "");
      return { kind: "REJECTED", httpStatus: res.status, detail: detail.slice(0, 500) };
    }

    const data = (await res.json()) as { id: string; status: string };
    return { kind: "SUCCESS", refundId: data.id, status: data.status };
  }

  /**
   * Backward-compatible wrapper. Existing callers that expect "returns or throws" keep working;
   * an ambiguous outcome is raised with `outcomeUnknown` set so a caller that cares can tell it
   * apart from a definite rejection instead of guessing from the message.
   */
  async createRefund(paymentId: string, amountInr: number, operationKey?: string) {
    const outcome = await this.executeGatewayRefund({ paymentId, amountInr, operationKey });
    if (outcome.kind === "SUCCESS") return { refundId: outcome.refundId, status: outcome.status };
    if (outcome.kind === "REJECTED") throw new Error(`Refund failed: ${outcome.detail}`);
    throw Object.assign(new Error(`Refund outcome unknown: ${outcome.kind}`), {
      outcomeUnknown: true,
      gatewayOutcome: outcome.kind,
    });
  }

  /** Refunds recorded at the gateway for one payment — the reconciliation read path. */
  async fetchRefundsForPayment(paymentId: string): Promise<GatewayRefundRecord[]> {
    if (!this.isConfigured) return [];
    const auth = Buffer.from(`${KEY_ID}:${KEY_SECRET}`).toString("base64");
    const res = await fetch(`https://api.razorpay.com/v1/payments/${paymentId}/refunds?count=100`, {
      headers: { Authorization: `Basic ${auth}` },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { items?: GatewayRefundRecord[] };
    return data.items ?? [];
  }
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) return false;
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export const razorpayService = new RazorpayService();
