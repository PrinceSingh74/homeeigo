import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { ratingService } from "../services/rating.service";
import { parseBody } from "../lib/route-security";
import {
  createRatingSchema,
  providerRatingResponseSchema,
  updateRatingSchema,
} from "../schemas/booking.schema";
import { tryValidate, validate } from "../middleware/validation.middleware";
import { idParamSchema } from "../schemas/common.schema";

export const ratingsRoutes = new Elysia({ prefix: "/api/ratings" })
  .use(authPlugin)
  // PUBLIC — platform-wide recent reviews for the customer home "Loved by
  // customers" rail. No auth (home is public); only public, non-flagged rows.
  // Registered before "/:bookingId" so the static path wins.
  .get("/recent", async ({ query }) => {
    const data = await ratingService.listPublicRecent(query as Record<string, string>);
    return { success: true, data };
  })
  .post(
    "/",
    async ({ requireAuth, body: raw, set }) => {
      const { userId } = requireAuth();
      const parsed = tryValidate(createRatingSchema, raw);
      if (!parsed.success) {
        set.status = 400;
        return {
          success: false,
          error: "Validation error",
          code: "VALIDATION_ERROR",
          details: parsed.details,
        };
      }
      const body = parsed.data;
      const rating = await ratingService.create(userId, body);
      if ("error" in rating) {
        if (rating.error === "TIP_INSUFFICIENT_WALLET") {
          set.status = 402;
          return {
            success: false,
            error: "Your wallet balance does not cover this tip. Add money or lower the tip.",
            code: "TIP_INSUFFICIENT_WALLET",
          };
        }
        if (rating.error === "TIP_FAILED") {
          set.status = 500;
          return { success: false, error: "Could not process the tip. Your review was not saved.", code: "TIP_FAILED" };
        }
        // Explicit, so neither falls through to the "booking not found" answer below.
        if (rating.error === "INVALID_PHOTOS") {
          set.status = 400;
          return { success: false, error: "Photos must be images you uploaded for this review (up to 6).", code: "INVALID_PHOTOS" };
        }
        if (rating.error === "VALIDATION_ERROR") {
          set.status = 400;
          return { success: false, error: "Rating must be between 1 and 5.", code: "VALIDATION_ERROR" };
        }
        set.status = 400;
        return { success: false, error: "Booking not found or already rated", code: "INVALID_BOOKING" };
      }
      set.status = 201;
      return {
        success: true,
        message: "Rating submitted successfully",
        data: {
          rating: {
            id: rating.id,
            bookingId: rating.bookingId,
            rating: rating.stars,
            createdAt: rating.createdAt,
          },
        },
      };
    },
    {
      body: t.Object({
        bookingId: t.String(),
        rating: t.Number(),
        reviewText: t.Optional(t.String()),
        photos: t.Optional(t.Array(t.String())),
        tipAmount: t.Optional(t.Number()),
        liked: t.Optional(t.Array(t.String())),
        couldImprove: t.Optional(t.Array(t.String())),
      }),
    },
  )
  .get("/:bookingId", async ({ requireAuth, params, set }) => {
    const { userId } = requireAuth();
    const rating = await ratingService.byBooking(userId, params.bookingId);
    if (!rating) {
      set.status = 404;
      return { success: false, error: "Rating not found", code: "RATING_NOT_FOUND" };
    }
    return { success: true, data: { rating } };
  })
  .put(
    "/:id",
    async ({ requireAuth, params: rawParams, body: raw, set }) => {
      const { userId } = requireAuth();
      const params = validate(idParamSchema, rawParams);
      const body = parseBody(updateRatingSchema, raw, { reviewText: { maxLen: 1000 } });
      const ok = await ratingService.update(userId, params.id, {
        rating: body.rating,
        reviewText: body.reviewText,
        photos: body.photos,
      });
      if (ok === "INVALID_PHOTOS") {
        set.status = 400;
        return { success: false, error: "Photos must be images you uploaded for this review (up to 6).", code: "INVALID_PHOTOS" };
      }
      if (!ok) {
        set.status = 404;
        return { success: false, error: "Rating not found", code: "NOT_FOUND" };
      }
      return { success: true, message: "Rating updated successfully" };
    },
    {
      body: t.Object({
        rating: t.Optional(t.Number()),
        reviewText: t.Optional(t.String()),
        photos: t.Optional(t.Array(t.String())),
      }),
    },
  )
  .post(
    "/:id/respond",
    async ({ requireProvider, params: rawParams, body: raw, set }) => {
      const { providerId } = requireProvider();
      const params = validate(idParamSchema, rawParams);
      const body = parseBody(providerRatingResponseSchema, raw, { response: { maxLen: 1000 } });
      const rating = await ratingService.providerRespond(providerId!, params.id, body.response);
      if (!rating) {
        set.status = 404;
        return { success: false, error: "Rating not found", code: "NOT_FOUND" };
      }
      return {
        success: true,
        message: "Response added successfully",
        data: {
          rating: {
            id: rating.id,
            providerResponse: rating.providerResponse,
            respondedAt: rating.respondedAt,
          },
        },
      };
    },
    { body: t.Object({ response: t.String() }) },
  );
