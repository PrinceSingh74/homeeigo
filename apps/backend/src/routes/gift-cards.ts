import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { giftCardService } from "../services/gift-card.service";

const clientIp = (request: Request) =>
  request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
  request.headers.get("x-real-ip") ||
  "unknown";

export const giftCardsRoutes = new Elysia({ prefix: "/api/giftcards" })
  .use(authPlugin)
  .get("/denominations", async () => {
    return { success: true, data: { denominations: giftCardService.denominations() } };
  })
  .get("/me", async ({ requireAuth }) => {
    const { userId } = requireAuth();
    const data = await giftCardService.myCards(userId);
    return { success: true, data };
  })
  .post(
    "/order",
    async ({ requireVerifiedEmail, body, set }) => {
      const { userId } = requireVerifiedEmail();
      const data = await giftCardService.createOrder(userId, body.amount, {
        recipientEmail: body.recipientEmail,
        recipientPhone: body.recipientPhone,
        message: body.message,
      });
      if (!data) {
        set.status = 400;
        return { success: false, error: "Invalid amount", code: "INVALID_AMOUNT" };
      }
      return { success: true, data };
    },
    {
      body: t.Object({
        amount: t.Number(),
        recipientEmail: t.Optional(t.String({ format: "email" })),
        recipientPhone: t.Optional(t.String()),
        message: t.Optional(t.String({ maxLength: 200 })),
      }),
    },
  )
  .post(
    "/verify",
    async ({ requireVerifiedEmail, body, set }) => {
      const { userId } = requireVerifiedEmail();
      const result = await giftCardService.verify(userId, body);
      if ("error" in result) {
        set.status = result.error === "INVALID_SIGNATURE" ? 400 : 404;
        return { success: false, error: result.error, code: result.error };
      }
      return { success: true, message: "Gift card activated", data: result };
    },
    {
      body: t.Object({
        razorpayOrderId: t.String(),
        razorpayPaymentId: t.String(),
        razorpaySignature: t.String(),
      }),
    },
  )
  .post(
    "/redeem",
    async ({ requireVerifiedEmail, body, request, set }) => {
      const { userId } = requireVerifiedEmail();
      const result = await giftCardService.redeem(userId, body.code, body.amount, {
        ipAddress: clientIp(request),
        userAgent: request.headers.get("user-agent") || "unknown",
        deviceId: request.headers.get("x-device-id") || undefined,
        userId,
      });
      if ("error" in result) {
        if (result.error === "RATE_LIMITED" || result.error === "POOL_BUSY") {
          set.status = 429;
          return {
            success: false,
            error:
              result.error === "POOL_BUSY"
                ? "System busy — please retry shortly"
                : "Too many redemption attempts. Please try later.",
            code: result.error === "POOL_BUSY" ? "RATE_LIMIT_EXCEEDED" : "RATE_LIMITED",
            blockedUntil: result.blockedUntil?.toISOString(),
          };
        }
        set.status = result.error === "INVALID_CODE" ? 404 : 400;
        return { success: false, error: result.error, code: result.error };
      }
      const msg =
        result.remaining > 0
          ? `₹${result.amount} added · ₹${result.remaining} left on the card`
          : `₹${result.amount} added to your wallet`;
      return { success: true, message: msg, data: result };
    },
    { body: t.Object({ code: t.String({ minLength: 4, maxLength: 32 }), amount: t.Optional(t.Number()) }) },
  )
  .post(
    "/:id/void",
    async ({ requireVerifiedEmail, params, set }) => {
      const { userId } = requireVerifiedEmail();
      const result = await giftCardService.void(userId, params.id);
      if ("error" in result) {
        set.status = result.error === "NOT_FOUND" ? 404 : 400;
        return { success: false, error: result.error, code: result.error };
      }
      return { success: true, message: `₹${result.refunded} refunded to your wallet`, data: result };
    },
    { params: t.Object({ id: t.String() }) },
  );
