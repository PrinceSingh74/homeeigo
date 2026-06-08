import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { referralService } from "../services/referral.service";
import { fraudContextFromRequest } from "../lib/fraud-context";

export const referralsRoutes = new Elysia({ prefix: "/api/referrals" })
  .use(authPlugin)
  .get("/me", async ({ requireAuth }) => {
    const { userId } = requireAuth();
    const data = await referralService.summary(userId);
    return { success: true, data };
  })
  .get("/history", async ({ requireAuth }) => {
    const { userId } = requireAuth();
    const data = await referralService.history(userId);
    return { success: true, data };
  })
  .get("/leaderboard", async () => {
    const leaderboard = await referralService.leaderboard(10);
    return { success: true, data: { leaderboard } };
  })
  .post(
    "/withdraw",
    async ({ requireVerifiedEmail, body, request, set }) => {
      const { userId } = requireVerifiedEmail();
      const ctx = fraudContextFromRequest(request, userId);
      const result = await referralService.withdraw(userId, body.amount, ctx);
      if ("error" in result) {
        set.status =
          result.error === "INSUFFICIENT_BALANCE"
            ? 400
            : result.error === "WITHDRAWAL_BLOCKED"
              ? 403
              : 422;
        return { success: false, error: result.error, code: result.error };
      }
      return { success: true, message: "Referral earnings moved to your wallet", data: result };
    },
    { body: t.Object({ amount: t.Number() }) },
  );
