import { Elysia, t } from "elysia";
import { catalogService } from "../services/catalog.service";

/**
 * The catalogue list is the hottest public read in the app, and every caller gets the same bytes for
 * a given query. The object was re-serialised on every request — measured at ~1.35 ms per request
 * for a 50-item page under the certification load profile, which is most of that endpoint's cost and
 * therefore most of the single-process throughput ceiling.
 *
 * So cache the SERIALISED body for a very short window and hand it back directly. The window is
 * shorter than the catalogue's own cache TTL (10 s L1 / 60 s shared), so this adds no extra
 * staleness beyond what the data cache already allows.
 */
const LIST_BODY_TTL_MS = 5_000;
const listBodyCache = new Map<string, { body: string; expires: number }>();

export const servicesRoutes = new Elysia({ prefix: "/api/services" })
  .get("/", async ({ query }) => {
    // Key on the parameters catalogService.list actually reads, so unknown query junk can neither
    // multiply cache entries nor thrash the map.
    const q = (query ?? {}) as Record<string, string | undefined>;
    const key = JSON.stringify([q.page, q.limit, q.category, q.city, q.minPrice, q.maxPrice, q.sortBy, q.categorySlug, q.subcategorySlug]);
    const now = Date.now();
    const hit = listBodyCache.get(key);
    if (hit && hit.expires > now) {
      return new Response(hit.body, { headers: { "Content-Type": "application/json;charset=utf-8" } });
    }
    const data = await catalogService.list(query as Record<string, string>);
    const body = JSON.stringify({ success: true, data });
    // Bounded: one entry per distinct query shape, and the map is cleared when it grows unreasonably.
    if (listBodyCache.size > 200) listBodyCache.clear();
    listBodyCache.set(key, { body, expires: now + LIST_BODY_TTL_MS });
    return new Response(body, { headers: { "Content-Type": "application/json;charset=utf-8" } });
  })
  /** Customer taxonomy: 13 categories and their subcategories, with live service counts. */
  .get("/categories", async () => {
    const data = await catalogService.categories();
    return { success: true, data };
  })
  .get("/featured", async () => {
    const data = await catalogService.featured();
    return { success: true, data };
  })
  .get("/category/:category", async ({ params, query }) => {
    const data = await catalogService.byCategory(params.category, query as Record<string, string>);
    return { success: true, data };
  })
  .post(
    "/search",
    async ({ body }) => {
      const data = await catalogService.search(body);
      return { success: true, data };
    },
    {
      body: t.Object({
        q: t.Optional(t.String()),
        category: t.Optional(t.String()),
        city: t.Optional(t.String()),
        minPrice: t.Optional(t.Number()),
        maxPrice: t.Optional(t.Number()),
        pricingModel: t.Optional(t.String()),
        audience: t.Optional(t.String()),
        bookingMode: t.Optional(t.String()),
        latitude: t.Optional(t.Number()),
        longitude: t.Optional(t.Number()),
        radius: t.Optional(t.Number()),
      }),
    },
  )
  /**
   * Resolve a selection (variant, quantity, audience, add-ons) against the server catalogue. Public
   * and read-only: returns price lines before tax, duration, every issue and add-on availability.
   * Booking still re-resolves on the server; nothing sent here is trusted later.
   */
  .post(
    "/:id/resolve-selection",
    async ({ params, body, set }) => {
      const result = await catalogService.resolveSelectionFor(params.id, body);
      if ("error" in result) {
        if (result.error === "NOT_FOUND") {
          set.status = 404;
          return { success: false, error: "Service not found", code: "NOT_FOUND" };
        }
        set.status = 409;
        return result.error === "SERVICE_VERSION_CHANGED"
          ? {
              success: false,
              error: "This service was updated — please review your selection",
              code: "SERVICE_VERSION_CHANGED",
              currentVersion: result.currentVersion,
            }
          : { success: false, error: "This service cannot be booked right now", code: "SERVICE_NOT_BOOKABLE" };
      }
      return { success: true, data: result };
    },
    {
      body: t.Object({
        variantId: t.Optional(t.String({ maxLength: 40 })),
        quantity: t.Optional(t.Number()),
        audience: t.Optional(t.String({ maxLength: 20 })),
        professionalPreference: t.Optional(t.String({ maxLength: 20 })),
        addonIds: t.Optional(t.Array(t.String({ maxLength: 40 }), { maxItems: 20 })),
        addonQuantities: t.Optional(t.Record(t.String({ maxLength: 40 }), t.Number())),
        packagePrice: t.Optional(t.Number()),
        serviceVersion: t.Optional(t.Integer({ minimum: 1 })),
      }),
    },
  )
  .get("/:id", async ({ params, set }) => {
    const service = await catalogService.byId(params.id);
    if (!service) {
      set.status = 404;
      return { success: false, error: "Service not found", code: "NOT_FOUND" };
    }
    return { success: true, data: { service } };
  });
