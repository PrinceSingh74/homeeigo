import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { paymentService } from "../services/payment.service";
import { razorpayService } from "../services/razorpay.service";
import { invoiceService } from "../services/invoice.service";
import { parseBody } from "../lib/route-security";
import { createOrderSchema, verifyPaymentSchema } from "../schemas/payment.schema";
import crypto from "crypto";
import { webhookDedupService } from "../services/webhook-dedup.service";

export const paymentsRoutes = new Elysia({ prefix: "/api/payments" })
  .post(
    "/webhook",
    async ({ request, set }) => {
      const signature = request.headers.get("x-razorpay-signature") ?? "";
      const raw = await request.text();

      if (!razorpayService.isWebhookConfigured) {
        set.status = 503;
        return { success: false, error: "Webhook not configured", code: "WEBHOOK_NOT_CONFIGURED" };
      }
      if (!razorpayService.verifyWebhookSignature(raw, signature)) {
        set.status = 401;
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
  })
  .post(
    "/:id/refund",
    async ({ requireRole, params, body, set }) => {
      const auth = requireRole("ADMIN");
      const data = await paymentService.refund(params.id, body.amount, body.reason, {
        userId: auth.userId,
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
  );
