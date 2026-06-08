import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { bookingService } from "../services/booking.service";
import { parseBody } from "../lib/route-security";
import {
  bookingCancelRouteSchema,
  createBookingSchema,
  geoPingSchema,
  updateBookingCustomerSchema,
} from "../schemas/booking.schema";
import { bookingAcceptSchema, bookingRejectSchema } from "../schemas/provider.schema";
import { validate } from "../middleware/validation.middleware";
import { idParamSchema } from "../schemas/common.schema";

export const bookingsRoutes = new Elysia({ prefix: "/api/bookings" })
  .use(authPlugin)
  .get("/upcoming", async ({ requireAuth }) => {
    const { userId } = requireAuth();
    const data = await bookingService.upcoming(userId);
    return { success: true, data };
  })
  .post(
    "/",
    async ({ requireVerifiedEmail, body: raw, set }) => {
      const { userId } = requireVerifiedEmail();
      const body = parseBody(createBookingSchema, raw, { description: { maxLen: 1000 } });
      const result = await bookingService.create(userId, {
        ...body,
        scheduledDate: body.scheduledDate.toISOString(),
      });
      if (result.error === "PROVIDER_UNAVAILABLE") {
        set.status = 400;
        return { success: false, error: "Provider is not available", code: "PROVIDER_UNAVAILABLE" };
      }
      if (result.error === "OVERLAPPING_BOOKING") {
        set.status = 409;
        return { success: false, error: "You have an overlapping booking", code: "OVERLAPPING_BOOKING" };
      }
      if (result.error === "UPGRADE_REQUIRED") {
        set.status = 403;
        return {
          success: false,
          error: "This is a premium-only service. Upgrade your membership to book it.",
          code: "UPGRADE_REQUIRED",
        };
      }
      if (
        result.error &&
        [
          "INVALID_CODE",
          "CAMPAIGN_INACTIVE",
          "NOT_STARTED",
          "EXPIRED",
          "MAX_REDEMPTIONS",
          "MIN_ORDER_NOT_MET",
          "PREMIUM_REQUIRED",
          "NO_DISCOUNT",
        ].includes(result.error)
      ) {
        set.status = 400;
        return { success: false, error: `Coupon error: ${result.error}`, code: result.error };
      }
      if (result.error === "VALIDATION_ERROR") {
        set.status = 400;
        return {
          success: false,
          error: "Invalid service or address. Add a saved address and try again.",
          code: "VALIDATION_ERROR",
        };
      }
      set.status = 201;
      return { success: true, message: "Booking created successfully", data: result };
    },
    {
      body: t.Object({
        serviceId: t.String(),
        providerId: t.Optional(t.String()),
        scheduledDate: t.String(),
        addressId: t.String(),
        description: t.Optional(t.String()),
        paymentMethod: t.Optional(t.String()),
        couponCode: t.Optional(t.String()),
      }),
    },
  )
  .get("/:id", async ({ requireAuth, params, set }) => {
    const { userId, providerId } = requireAuth();
    const booking = await bookingService.getById(
      params.id,
      providerId ? undefined : userId,
      providerId ?? undefined,
    );
    if (!booking) {
      set.status = 404;
      return { success: false, error: "Booking not found", code: "NOT_FOUND" };
    }
    return { success: true, data: { booking } };
  })
  .put(
    "/:id",
    async ({ requireAuth, params: rawParams, body: raw, set }) => {
      const { userId } = requireAuth();
      const params = validate(idParamSchema, rawParams);
      const body = parseBody(updateBookingCustomerSchema, raw, { description: { maxLen: 1000 } });
      const result = await bookingService.update(userId, params.id, {
        scheduledDate: body.scheduledDate?.toISOString(),
        description: body.description,
      });
      if (result.error === "INVALID_STATUS") {
        set.status = 400;
        return { success: false, error: "Cannot reschedule a booking in progress", code: "INVALID_STATUS" };
      }
      if (result.error === "NOT_FOUND") {
        set.status = 404;
        return { success: false, error: "Booking not found", code: "NOT_FOUND" };
      }
      return { success: true, message: "Booking updated successfully" };
    },
    {
      body: t.Object({
        scheduledDate: t.Optional(t.String()),
        description: t.Optional(t.String()),
      }),
    },
  )
  .post(
    "/:id/accept",
    async ({ requireProvider, params: rawParams, body: raw, set }) => {
      const { providerId } = requireProvider();
      const params = validate(idParamSchema, rawParams);
      const body = parseBody(bookingAcceptSchema, raw);
      const booking = await bookingService.accept(providerId!, params.id, body.eta);
      if (!booking) {
        set.status = 400;
        return { success: false, error: "Cannot accept booking", code: "INVALID_STATUS" };
      }
      return {
        success: true,
        message: "Booking accepted",
        data: {
          booking: {
            id: booking.id,
            status: "accepted",
            provider: { name: booking.provider?.user.firstName },
          },
        },
      };
    },
    { body: t.Object({ eta: t.Optional(t.Number()) }) },
  )
  .post(
    "/:id/reject",
    async ({ requireProvider, params: rawParams, body: raw }) => {
      const { providerId } = requireProvider();
      const params = validate(idParamSchema, rawParams);
      const body = parseBody(bookingRejectSchema, raw, { reason: { maxLen: 500 } });
      await bookingService.reject(providerId!, params.id, body.reason);
      return { success: true, message: "Booking rejected" };
    },
    { body: t.Object({ reason: t.String() }) },
  )
  .post(
    "/:id/start",
    async ({ requireProvider, params: rawParams, body: raw, set }) => {
      const { providerId } = requireProvider();
      const params = validate(idParamSchema, rawParams);
      const body = parseBody(geoPingSchema, raw);
      try {
        const booking = await bookingService.start(
          providerId!,
          params.id,
          body.latitude,
          body.longitude,
        );
        return {
          success: true,
          message: "Job started",
          data: { booking: { status: "in_progress", startedAt: booking.startedAt } },
        };
      } catch {
        set.status = 403;
        return { success: false, error: "Forbidden", code: "FORBIDDEN" };
      }
    },
    {
      body: t.Object({ latitude: t.Number(), longitude: t.Number() }),
    },
  )
  .post(
    "/:id/complete",
    async ({ requireProvider, params: rawParams, body: raw }) => {
      const { providerId } = requireProvider();
      const params = validate(idParamSchema, rawParams);
      const body = parseBody(geoPingSchema, raw, { notes: { maxLen: 500 } });
      const result = await bookingService.complete(
        providerId!,
        params.id,
        body.latitude,
        body.longitude,
        body.notes,
      );
      return {
        success: true,
        message: "Job completed",
        data: {
          booking: {
            status: "completed",
            completedAt: result?.booking.completedAt,
            totalDuration: result?.totalDuration,
          },
        },
      };
    },
    {
      body: t.Object({
        latitude: t.Number(),
        longitude: t.Number(),
        photos: t.Optional(t.Array(t.String())),
        notes: t.Optional(t.String()),
      }),
    },
  )
  .post(
    "/:id/cancel",
    async ({ requireAuth, params: rawParams, body: raw, set }) => {
      const auth = requireAuth();
      const params = validate(idParamSchema, rawParams);
      const body = parseBody(bookingCancelRouteSchema, raw, { reason: { maxLen: 500 } });
      const result = await bookingService.cancel(
        { userId: auth.userId, providerId: auth.providerId },
        params.id,
        body.reason,
      );
      if (result.error === "INVALID_STATUS") {
        set.status = 400;
        return { success: false, error: "Cannot cancel a completed booking", code: "INVALID_STATUS" };
      }
      if (result.error === "NOT_FOUND") {
        set.status = 404;
        return { success: false, error: "Booking not found", code: "NOT_FOUND" };
      }
      if (result.error === "REFUND_FAILED") {
        set.status = 502;
        return { success: false, error: "Refund could not be processed", code: "REFUND_FAILED" };
      }
      return {
        success: true,
        message: "Booking cancelled successfully",
        data: { booking: { id: params.id, status: result.status, refundAmount: result.refundAmount } },
      };
    },
    {
      body: t.Object({
        reason: t.String(),
      }),
    },
  );
