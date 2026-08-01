/**
 * Customer Intelligence API (Phase-4 Track 3).
 * RBAC: a customer reads their OWN profile (/me); ADMIN reads any customer (/:userId).
 * Match + recommendation-click are available to any authenticated user.
 * Every analytics response carries confidence + freshness.
 */
import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { customerIntelligenceService as svc } from "../services/customer-intelligence.service";
import { incCounter } from "../lib/metrics";

export const customerIntelligenceRoutes = new Elysia({ prefix: "/api/customer-intel" })
  .use(authPlugin)

  .get("/me", async ({ requireAuth }) => {
    const u = requireAuth();
    return { success: true, ...(await svc.profile(u.userId)) };
  })

  .get("/match", async ({ requireAuth, query, set }) => {
    requireAuth();
    const lat = Number(query.lat), lng = Number(query.lng);
    if ([lat, lng].some((n) => Number.isNaN(n))) { set.status = 400; return { success: false, error: "lat,lng required" }; }
    return { success: true, ...(await svc.smartMatch({ lat, lng, serviceId: query.serviceId, limit: query.limit ? Number(query.limit) : undefined })) };
  }, { query: t.Object({ lat: t.String(), lng: t.String(), serviceId: t.Optional(t.String()), limit: t.Optional(t.String()) }) })

  .post("/recommendation-click", async ({ requireAuth, body }) => {
    requireAuth();
    const kind = (body as { kind?: string })?.kind ?? "unknown";
    incCounter("customer_recommendation_clicks_total", { kind });
    return { success: true };
  }, { body: t.Object({ kind: t.Optional(t.String()) }) })

  // Admin: any customer's intelligence profile.
  .get("/:userId", async ({ requireRole, params }) => {
    requireRole("ADMIN");
    return { success: true, ...(await svc.profile(params.userId)) };
  });
