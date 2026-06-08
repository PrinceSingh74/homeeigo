import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { hcoinService } from "../services/hcoin.service";

export const hcoinsRoutes = new Elysia({ prefix: "/api/hcoins" })
  .use(authPlugin)
  .get("/me", async ({ requireAuth }) => {
    const { userId } = requireAuth();
    const data = await hcoinService.summary(userId);
    return { success: true, data };
  })
  .get("/history", async ({ requireAuth }) => {
    const { userId } = requireAuth();
    const transactions = await hcoinService.history(userId);
    return { success: true, data: { transactions } };
  })
  .post(
    "/redeem",
    async ({ requireAuth, body, set }) => {
      const { userId } = requireAuth();
      const result = await hcoinService.redeem(userId, body.coins);
      if ("error" in result) {
        set.status = result.error === "INSUFFICIENT_COINS" ? 400 : 422;
        return { success: false, error: result.error, code: result.error };
      }
      return { success: true, message: `Redeemed for ₹${result.rupees} wallet credit`, data: result };
    },
    { body: t.Object({ coins: t.Number() }) },
  );
