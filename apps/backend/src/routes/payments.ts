import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { createAdminRbacPlugin } from "../middleware/admin-rbac";
import { rbacService } from "../services/rbac.service";
import { paymentService } from "../services/payment.service";
import { razorpayService } from "../services/razorpay.service";
import { invoiceService } from "../services/invoice.service";
import { parseBody } from "../lib/route-security";
import { createOrderSchema, verifyPaymentSchema } from "../schemas/payment.schema";
import crypto from "crypto";
import { webhookDedupService } from "../services/webhook-dedup.service";
import { setCausationId } from "../events/core/event-context";
import { logger } from "../lib/logger";
import { observability } from "../lib/observability";
import { incCounter } from "../lib/metrics";

/** Throttle for the "webhook secret not configured" warn — prevents alert storms (see webhook handler). */
let lastUnconfiguredWarnAt = 0;

/** Route must be registered on the RBAC plugin instance so scoped auth/RBAC derives apply. */
const paymentRefundRoutes = createAdminRbacPlugin("admin-rbac-payment-refund").group(
  "/api/payments",
  (app) =>
    app.post(
      "/:id/refund",
      async ({ requireAdminContext, params, body, set }) => {
        const admin = requireAdminContext();
        await rbacService.enforcePermission(admin, "PAYMENTS", "APPROVE");
        const data = await paymentService.refund(params.id, body.amount, body.reason, {
          userId: admin.userId,
          isAdmin: true,
        });
        if ("error" in data) {
          const code = data.error;
          set.status =
            code === "FORBIDDEN"
              ? 403
              : code === "NOT_FOUND"
                ? 404
                : code === "AMOUNT_EXCEEDS_REFUNDABLE" || code === "INVALID_AMOUNT"
                  ? 400
                  : 422;
          return { success: false, error: code, code };
        }
        return { success: true, message: "Refund initiated", data };
      },
      {
        body: t.Object({ reason: t.String(), amount: t.Number() }),
      },
    ),
);

export const paymentsRoutes = new Elysia()
  .use(
    new Elysia({ prefix: "/api/payments" })
  .post(
    "/webhook",
    async ({ request, set }) => {
      const signature = request.headers.get("x-razorpay-signature") ?? "";
      const raw = await request.text();

      // Authenticate FIRST. A missing signature, an unconfigured secret, or a bad
      // signature all return 401 — never reveal config state (503) to an unsigned
      // caller (pentest: webhook must answer 401/403, not 503). A genuine
      // misconfiguration is surfaced to ops via logs + Sentry, not to the caller.
      if (!razorpayService.isWebhookConfigured) {
        // Throttle to once / 5 min. Without this, every webhook retry + scanner hit on an
        // unconfigured env logs a warn (the root cause of the 10,734 historical occurrences —
        // an alert storm, not 10k distinct incidents). The 401 rejection below is unchanged.
        const now = Date.now();
        if (now - lastUnconfiguredWarnAt > 300_000) {
          lastUnconfiguredWarnAt = now;
          logger.warn("payments.webhook: RAZORPAY_WEBHOOK_SECRET not configured — rejecting as unauthorized (throttled 5m)");
          if (process.env.NODE_ENV === "production") {
            observability.captureMessage("Razorpay webhook secret not configured", { category: "payment", level: "warning" });
          }
        }
      }
      if (!signature || !razorpayService.isWebhookConfigured || !razorpayService.verifyWebhookSignature(raw, signature)) {
        set.status = 401;
        incCounter("webhook_verification_failed_total", { provider: "razorpay" });
        incCounter("suspicious_activity_total", { kind: "webhook_bad_signature" });
        return { success: false, error: "Invalid signature", code: "INVALID_SIGNATURE" };
      }

      let event: { event: string; payload: Record<string, unknown> };
      try {
        event = JSON.parse(raw);
      } catch {
        set.status = 400;
        return { success: false, error: "Invalid JSON", code: "INVALID_PAYLOAD" };
      }

      const gatewayEventId = request.headers.get("x-razorpay-event-id") ?? undefined;
      const eventId = gatewayEventId ?? crypto.createHash("sha256").update(raw).digest("hex");
      const begin = await webhookDedupService.beginProcessing(eventId, event.event, gatewayEventId);
      if (begin === "SKIP") {
        return { success: true, ignored: true, reason: "DUPLICATE_EVENT" };
      }

      try {
        setCausationId(eventId);
        const result = await paymentService.reconcileFromWebhook(event as never);
        if (!result.handled) {
          if (result.reason === "PAYMENT_ID_CONFLICT") {
            await webhookDedupService.markFailed(eventId, result.reason);
            set.status = 409;
            return { success: false, error: "Payment id conflict", code: "PAYMENT_ID_CONFLICT" };
          }
          if (result.reason === "UNHANDLED_EVENT" || result.reason === "PAYMENT_NOT_FOUND") {
            await webhookDedupService.markProcessed(eventId);
            return { success: true, ignored: true, reason: result.reason };
          }
          if (result.reason === "AUTHORIZED_AWAITING_CAPTURE") {
            await webhookDedupService.markProcessed(eventId);
            return { success: true, ignored: true, reason: result.reason };
          }
          await webhookDedupService.markFailed(eventId, result.reason);
          set.status = 422;
          return { success: false, error: "Webhook not processed", code: result.reason };
        }
        await webhookDedupService.markProcessed(eventId);
        return { success: true, reason: result.reason };
      } catch (err) {
        const message = err instanceof Error ? err.message : "WEBHOOK_PROCESSING_ERROR";
        await webhookDedupService.markFailed(eventId, message);
        set.status = 500;
        return { success: false, error: "Webhook processing failed", code: "WEBHOOK_ERROR" };
      }
    },
  )
  .post(
    "/e2e/mock-signature",
    async ({ body, set }) => {
      if (process.env.NODE_ENV === "production") {
        set.status = 404;
        return { success: false, error: "Not found", code: "NOT_FOUND" };
      }
      const signature = razorpayService.computePaymentSignature(
        body.razorpayOrderId,
        body.razorpayPaymentId,
      );
      return { success: true, data: { razorpaySignature: signature } };
    },
    {
      body: t.Object({
        razorpayOrderId: t.String({ minLength: 1 }),
        razorpayPaymentId: t.String({ minLength: 1 }),
      }),
    },
  )
  .use(authPlugin)
  .get("/history", async ({ requireAuth, query }) => {
    const { userId } = requireAuth();
    const data = await paymentService.history(userId, query as Record<string, string>);
    return { success: true, data };
  })
  .post(
    "/create-order",
    async ({ requireVerifiedEmail, body: raw, set }) => {
      const { userId } = requireVerifiedEmail();
      const body = parseBody(createOrderSchema, raw);
      // amount is intentionally ignored — the backend derives the charge from
      // the booking (single source of truth); a client cannot set the price.
      const order = await paymentService.createOrder(userId, body.bookingId);
      if (!order) {
        set.status = 404;
        return { success: false, error: "Booking not found", code: "NOT_FOUND" };
      }
      return { success: true, data: order };
    },
    {
      body: t.Object({
        bookingId: t.String(),
        amount: t.Optional(t.Number()),
        currency: t.Optional(t.String()),
      }),
    },
  )
  .post(
    "/verify",
    async ({ requireVerifiedEmail, body: raw, set }) => {
      const { userId } = requireVerifiedEmail();
      const body = parseBody(verifyPaymentSchema, raw);
      const result = await paymentService.verify(userId, body);
      if (result.error === "INVALID_SIGNATURE") {
        set.status = 400;
        return { success: false, error: "Invalid payment signature", code: "INVALID_SIGNATURE" };
      }
      if (result.error === "NOT_FOUND") {
        set.status = 404;
        return { success: false, error: "Payment not found", code: "NOT_FOUND" };
      }
      if (result.error === "ALREADY_SETTLED") {
        set.status = 409;
        return { success: false, error: "Payment already settled", code: "ALREADY_SETTLED" };
      }
      if (result.error === "EXPIRED") {
        set.status = 400;
        return { success: false, error: "Top-up expired. Please start a new top-up.", code: "EXPIRED" };
      }
      if (result.error === "FAILED") {
        set.status = 400;
        return { success: false, error: "Top-up failed. Please try again.", code: "FAILED" };
      }
      return { success: true, message: "Payment verified successfully", data: result };
    },
    {
      body: t.Object({
        razorpayOrderId: t.String(),
        razorpayPaymentId: t.String(),
        razorpaySignature: t.String(),
      }),
    },
  )
  .get("/:id", async ({ requireAuth, params, set }) => {
    const { userId } = requireAuth();
    const payment = await paymentService.getById(userId, params.id);
    if (!payment) {
      set.status = 404;
      return { success: false, error: "Payment not found", code: "NOT_FOUND" };
    }
    return { success: true, data: { payment } };
  })
  .get("/:id/invoice", async ({ requireAuth, params, set }) => {
    const { userId } = requireAuth();
    const html = await invoiceService.render(userId, params.id);
    if (!html) {
      set.status = 404;
      return { success: false, error: "Invoice not available", code: "NOT_FOUND" };
    }
    set.headers["content-type"] = "text/html; charset=utf-8";
    return html;
  }),
  )
  .use(paymentRefundRoutes);
