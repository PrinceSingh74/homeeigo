import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { walletService } from "../services/wallet.service";
import { transferService } from "../services/transfer.service";
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
  .post(
    "/add-money",
    async ({ requireVerifiedEmail, body: raw, set }) => {
      const { userId } = requireVerifiedEmail();
      const body = parseBody(walletTopUpSchema, raw);
      const data = await walletService.addMoney(userId, body.amount);
      if (!data) {
        set.status = 404;
        return { success: false, error: "User not found", code: "NOT_FOUND" };
      }
      return { success: true, data };
    },
    {
      body: t.Object({
        amount: t.Number(),
        paymentMethod: t.Optional(t.String()),
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
  );
