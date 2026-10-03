/**
 * City Digital Twin API (Phase-4 Track 4) — ADMIN only.
 * Aggregation + simulation over verified services. Every response carries confidence + freshness.
 */
import { Elysia, t } from "elysia";
import { scenarioSimulationService } from "../services/scenario-simulation.service";
import { authPlugin } from "../plugins/auth.plugin";
import { digitalTwinService as svc, SUPPORTED_CITIES } from "../services/digital-twin.service";

export const digitalTwinRoutes = new Elysia({ prefix: "/api/digital-twin" })
  .use(authPlugin)

  .get("/cities", async ({ requireRole }) => {
    requireRole("ADMIN");
    return { success: true, supported: SUPPORTED_CITIES, ...(await svc.cities()) };
  })

  .get("/:city", async ({ requireRole, params }) => {
    requireRole("ADMIN");
    return { success: true, ...(await svc.cityTwin(params.city)) };
  })

  .get("/:city/insights", async ({ requireRole, params }) => {
    requireRole("ADMIN");
    return { success: true, ...(await svc.executiveInsights(params.city)) };
  })

  .post("/:city/simulate", async ({ requireRole, params, body }) => {
    requireRole("ADMIN");
    return { success: true, ...(await svc.simulate(params.city, body)) };
  }, {
    body: t.Object({
      demandDeltaPct: t.Optional(t.Number()),
      providerDeltaPct: t.Optional(t.Number()),
      trafficDeltaPct: t.Optional(t.Number()),
      rainStart: t.Optional(t.Boolean()),
      festival: t.Optional(t.Boolean()),
    }),
  })

  /**
   * Phase 15 — the same scenario, with the provenance an executive needs before acting on it.
   *
   * Mounted beside `/simulate` rather than replacing it: the existing route has consumers, and
   * silently changing its response shape would break them. This one returns the assumptions by
   * name, the real data freshness, a reproducible scenario id, and an explicit statement that the
   * model has never been backtested — none of which the original response carries.
   */
  .post("/:city/scenario", async ({ requireRole, params, body }) => {
    requireRole("ADMIN");
    return { success: true, data: await scenarioSimulationService.simulate(params.city, body) };
  }, {
    body: t.Object({
      demandDeltaPct: t.Optional(t.Number({ minimum: -100, maximum: 500 })),
      providerDeltaPct: t.Optional(t.Number({ minimum: -100, maximum: 500 })),
      trafficDeltaPct: t.Optional(t.Number({ minimum: -100, maximum: 500 })),
      rainStart: t.Optional(t.Boolean()),
      festival: t.Optional(t.Boolean()),
    }),
  })

  /** Executive what-if: baseline / scenario / delta, read-only, with no currency conversion. */
  .post("/:city/what-if", async ({ requireRole, params, body }) => {
    requireRole("ADMIN");
    return { success: true, data: await scenarioSimulationService.whatIf(params.city, body) };
  }, {
    body: t.Object({
      demandDeltaPct: t.Optional(t.Number({ minimum: -100, maximum: 500 })),
      providerDeltaPct: t.Optional(t.Number({ minimum: -100, maximum: 500 })),
      trafficDeltaPct: t.Optional(t.Number({ minimum: -100, maximum: 500 })),
      rainStart: t.Optional(t.Boolean()),
      festival: t.Optional(t.Boolean()),
    }),
  })
  ;
