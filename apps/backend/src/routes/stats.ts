import { Elysia } from "elysia";
import { statsService } from "../services/stats.service";

export const statsRoutes = new Elysia({ prefix: "/api/stats" }).get("/overview", async () => {
  const data = await statsService.overview();
  return { success: true, data };
});
