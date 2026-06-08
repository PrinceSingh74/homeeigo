import { Elysia, t } from "elysia";
import { catalogService } from "../services/catalog.service";

export const servicesRoutes = new Elysia({ prefix: "/api/services" })
  .get("/", async ({ query }) => {
    const data = await catalogService.list(query as Record<string, string>);
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
        latitude: t.Optional(t.Number()),
        longitude: t.Optional(t.Number()),
        radius: t.Optional(t.Number()),
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
