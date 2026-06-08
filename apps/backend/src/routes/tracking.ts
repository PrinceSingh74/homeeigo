import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { trackingService } from "../services/tracking.service";
import { parseBody } from "../lib/route-security";
import { trackingLocationSchema } from "../schemas/provider.schema";

export const trackingRoutes = new Elysia({ prefix: "/api/tracking" })
  .use(authPlugin)
  .post(
    "/location",
    async ({ requireProvider, body: raw, set }) => {
      const { providerId } = requireProvider();
      const body = parseBody(trackingLocationSchema, raw);
      const result = await trackingService.updateLocation(providerId!, body);
      if (!result) {
        set.status = 400;
        return { success: false, error: "Invalid booking for tracking", code: "INVALID_STATUS" };
      }
      return { success: true, message: "Location updated" };
    },
    {
      body: t.Object({
        bookingId: t.String(),
        latitude: t.Number(),
        longitude: t.Number(),
        accuracy: t.Optional(t.Number()),
        altitude: t.Optional(t.Number()),
      }),
    },
  )
  .get("/:bookingId", async ({ requireAuth, params, set }) => {
    const auth = requireAuth();
    const tracking = await trackingService.get(
      params.bookingId,
      auth.providerId ? undefined : auth.userId,
      auth.providerId,
    );
    if (!tracking) {
      set.status = 404;
      return { success: false, error: "Tracking not found", code: "NOT_FOUND" };
    }
    return { success: true, data: { tracking } };
  });
