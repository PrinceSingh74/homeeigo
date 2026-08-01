import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { walletService } from "../services/wallet.service";
import { walletCheckoutService } from "../services/wallet-checkout.service";
import { transferService } from "../services/transfer.service";
import { paymentMethodService } from "../services/payment-method.service";
import { parseBody } from "../lib/route-security";
import { walletTopUpSchema, walletWithdrawSchema } from "../schemas/payment.schema";
import prisma from "../lib/prisma";

export const walletRoutes = new Elysia({ prefix: "/api/wallet" })
  .use(authPlugin)
  .get("/balance", async ({ requireAuth }) => {
    const { userId } = requireAuth();
    const data = await walletService.balance(userId);
    return { success: true, data };
  })
  .get("/transactions", async ({ requireAuth, query }) => {
    const { userId } = requireAuth();
    const data = await walletService.transactions(userId, query as Record<string, string>);
    return { success: true, data };
  })
  .get("/offers", async () => {
    return { success: true, data: { offers: walletService.offers() } };
  })
  // Phase 18 — wallet checkout: quote then pay a booking from wallet balance.
  .post(
    "/checkout/quote",
    async ({ requireAuth, body, set }) => {
      const { userId } = requireAuth();
      const quote = await walletCheckoutService.quote(userId, (body as { bookingId: string }).bookingId);
      if ("error" in quote) {
        set.status = 404;
        return { success: false, error: "Booking not found", code: quote.error };
      }
      return { success: true, data: quote };
    },
    { body: t.Object({ bookingId: t.String() }) },
  )
  .post(
    "/checkout/pay",
    async ({ requireVerifiedEmail, body, set }) => {
      const { userId } = requireVerifiedEmail();
      const result = await walletCheckoutService.payBookingFromWallet(userId, (body as { bookingId: string }).bookingId);
      if ("error" in result) {
        set.status = result.error === "BOOKING_NOT_FOUND" ? 404 : result.error === "INSUFFICIENT_WALLET_BALANCE" ? 402 : 409;
        return { success: false, error: result.error.replace(/_/g, " ").toLowerCase(), code: result.error };
      }
      return { success: true, data: result };
    },
    { body: t.Object({ bookingId: t.String() }) },
  )
  .post(
    "/checkout/split/initiate",
    async ({ requireVerifiedEmail, body, set }) => {
      const { userId } = requireVerifiedEmail();
      const b = body as { bookingId: string; walletAmount: number };
      const result = await walletCheckoutService.initiateSplit(userId, b.bookingId, b.walletAmount);
      if ("error" in result) {
        set.status = result.error === "BOOKING_NOT_FOUND" ? 404 : result.error === "INSUFFICIENT_WALLET_BALANCE" ? 402 : result.error === "ALREADY_PAID" ? 409 : 400;
        return { success: false, error: result.error.replace(/_/g, " ").toLowerCase(), code: result.error };
      }
      return { success: true, data: result };
    },
    { body: t.Object({ bookingId: t.String(), walletAmount: t.Number() }) },
  )
  .post(
    "/checkout/split/verify",
    async ({ requireVerifiedEmail, body, set }) => {
      const { userId } = requireVerifiedEmail();
      const result = await walletCheckoutService.verifySplit(userId, body as { razorpayOrderId: string; razorpayPaymentId: string; razorpaySignature: string });
      if ("error" in result) {
        set.status = result.error === "NOT_FOUND" ? 404 : result.error === "INVALID_SIGNATURE" ? 400 : result.error === "WALLET_DEBIT_FAILED" ? 402 : 409;
        return { success: false, error: result.error.replace(/_/g, " ").toLowerCase(), code: result.error };
      }
      return { success: true, data: result };
    },
    {
      body: t.Object({
        razorpayOrderId: t.String(),
        razorpayPaymentId: t.String(),
        razorpaySignature: t.String(),
      }),
    },
  )
  // Phase 18.3 — multi-source: Gift Card → HCoin → Wallet → Razorpay.
  .post(
    "/checkout/multi-source/quote",
    async ({ requireAuth, body, set }) => {
      const { userId } = requireAuth();
      const b = body as { bookingId: string; giftCardCode?: string; hCoinCoins?: number };
      const q = await walletCheckoutService.multiSourceQuote(userId, b.bookingId, { giftCardCode: b.giftCardCode, hCoinCoins: b.hCoinCoins });
      if ("error" in q) {
        set.status = 404;
        return { success: false, error: "Booking not found", code: q.error };
      }
      return { success: true, data: q };
    },
    { body: t.Object({ bookingId: t.String(), giftCardCode: t.Optional(t.String()), hCoinCoins: t.Optional(t.Number()) }) },
  )
  .post(
    "/checkout/multi-source/pay",
    async ({ requireVerifiedEmail, body, set }) => {
      const { userId } = requireVerifiedEmail();
      const b = body as { bookingId: string; giftCardCode?: string; hCoinCoins?: number; useWallet?: boolean };
      const result = await walletCheckoutService.payMultiSource(userId, b.bookingId, { giftCardCode: b.giftCardCode, hCoinCoins: b.hCoinCoins, useWallet: b.useWallet });
      if ("error" in result) {
        set.status = result.error === "BOOKING_NOT_FOUND" ? 404 : result.error === "ALREADY_PAID" ? 409 : result.error.startsWith("GIFT_CARD_") || result.error.startsWith("HCOIN_") || result.error === "INSUFFICIENT_WALLET_BALANCE" ? 402 : 400;
        return { success: false, error: result.error.replace(/_/g, " ").toLowerCase(), code: result.error };
      }
      return { success: true, data: result };
    },
    {
      body: t.Object({
        bookingId: t.String(),
        giftCardCode: t.Optional(t.String()),
        hCoinCoins: t.Optional(t.Number()),
        useWallet: t.Optional(t.Boolean()),
      }),
    },
  )
  .post(
    "/add-money",
    async ({ requireVerifiedEmail, body: raw, set }) => {
      const { userId } = requireVerifiedEmail();
      const body = parseBody(walletTopUpSchema, raw);
      const data = await walletService.addMoney(userId, body.amount, {
        idempotencyKey: body.idempotencyKey,
      });
      if ("error" in data) {
        if (data.error === "USER_NOT_FOUND") {
          set.status = 404;
          return { success: false, error: "User not found", code: "NOT_FOUND" };
        }
        if (data.error === "TOO_MANY_PENDING") {
          set.status = 429;
          return {
            success: false,
            error: "Too many pending wallet top-ups",
            code: "TOO_MANY_PENDING",
          };
        }
        set.status = 400;
        return { success: false, error: "Invalid amount", code: data.error };
      }
      return { success: true, data };
    },
    {
      body: t.Object({
        amount: t.Number(),
        paymentMethod: t.Optional(t.String()),
        idempotencyKey: t.Optional(t.String()),
      }),
    },
  )
  .post(
    "/withdraw",
    async ({ requireProvider, requireVerifiedEmail, body: raw, set }) => {
      const { providerId } = requireProvider();
      requireVerifiedEmail();
      const body = parseBody(walletWithdrawSchema, raw, { accountHolder: { maxLen: 100 } });
      const result = await walletService.withdraw(providerId!, {
        amount: body.amount,
        bankAccountNumber: body.bankAccountNumber,
        ifscCode: body.ifscCode,
        accountHolder: body.accountHolder,
      });
      if ("error" in result) {
        set.status = 400;
        return { success: false, error: "Insufficient wallet balance", code: "INSUFFICIENT_BALANCE" };
      }
      const w = await prisma.withdrawal.findUnique({ where: { id: result.withdrawal.id } });
      if (!w) {
        set.status = 500;
        return { success: false, error: "Withdrawal not found", code: "INTERNAL_ERROR" };
      }
      set.status = 201;
      return {
        success: true,
        message: "Withdrawal request submitted",
        data: {
          withdrawal: {
            id: w.id,
            withdrawalNumber: w.withdrawalNumber,
            amount: w.amount,
            status: w.status.toLowerCase(),
            createdAt: w.createdAt,
          },
        },
      };
    },
    {
      body: t.Object({
        amount: t.Number(),
        bankAccountNumber: t.String(),
        ifscCode: t.String(),
        accountHolder: t.String(),
      }),
    },
  )
  // ===== P2P transfers =====
  .get("/transfers", async ({ requireAuth }) => {
    const { userId } = requireAuth();
    const data = await transferService.history(userId);
    return { success: true, data };
  })
  .post(
    "/transfer/initiate",
    async ({ requireVerifiedEmail, body, set }) => {
      const { userId } = requireVerifiedEmail();
      const result = await transferService.initiate(userId, body.recipient, body.amount, body.note);
      if ("error" in result) {
        set.status = result.error === "RECIPIENT_NOT_FOUND" ? 404 : 400;
        return { success: false, error: result.error, code: result.error };
      }
      return { success: true, message: "OTP sent to confirm transfer", data: result };
    },
    {
      body: t.Object({
        recipient: t.String({ minLength: 3, maxLength: 64 }),
        amount: t.Number(),
        note: t.Optional(t.String({ maxLength: 140 })),
      }),
    },
  )
  .post(
    "/transfer/confirm",
    async ({ requireVerifiedEmail, body, set }) => {
      const { userId } = requireVerifiedEmail();
      const result = await transferService.confirm(userId, body.transferId, body.otp);
      if ("error" in result) {
        set.status = result.error === "INVALID_OTP" ? 400 : 422;
        return { success: false, error: result.error, code: result.error };
      }
      return { success: true, message: "Transfer completed", data: result };
    },
    { body: t.Object({ transferId: t.String(), otp: t.String() }) },
  )
  // ===== Saved payment methods (metadata only — charges go through Razorpay) =====
  .get("/payment-methods", async ({ requireAuth }) => {
    const { userId } = requireAuth();
    const data = await paymentMethodService.list(userId);
    return { success: true, data };
  })
  .post(
    "/payment-methods",
    async ({ requireAuth, body, set }) => {
      const { userId } = requireAuth();
      const result = await paymentMethodService.add(userId, {
        type: body.type,
        label: body.label,
        last4: body.last4,
        network: body.network,
        upiHandle: body.upiHandle,
        setDefault: body.setDefault,
      });
      if ("error" in result) {
        set.status = result.error === "LIMIT_REACHED" ? 409 : 400;
        return { success: false, error: result.error, code: result.error };
      }
      set.status = 201;
      return { success: true, message: "Payment method saved", data: result };
    },
    {
      body: t.Object({
        type: t.Union([t.Literal("CARD"), t.Literal("UPI"), t.Literal("BANK")]),
        label: t.String({ minLength: 1, maxLength: 50 }),
        last4: t.Optional(t.String({ maxLength: 4 })),
        network: t.Optional(t.String({ maxLength: 24 })),
        upiHandle: t.Optional(t.String({ maxLength: 100 })),
        setDefault: t.Optional(t.Boolean()),
      }),
    },
  )
  .delete("/payment-methods/:id", async ({ requireAuth, params, set }) => {
    const { userId } = requireAuth();
    const result = await paymentMethodService.remove(userId, params.id);
    if ("error" in result) {
      set.status = 404;
      return { success: false, error: "Payment method not found", code: result.error };
    }
    return { success: true, message: "Payment method removed" };
  })
  .post("/payment-methods/:id/set-default", async ({ requireAuth, params, set }) => {
    const { userId } = requireAuth();
    const result = await paymentMethodService.setDefault(userId, params.id);
    if ("error" in result) {
      set.status = 404;
      return { success: false, error: "Payment method not found", code: result.error };
    }
    return { success: true, message: "Default payment method updated", data: result };
  });
