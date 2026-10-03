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
import { recommendForCustomer, deterministicReason, type Recommendation } from "../services/service-recommendation.service";
import { isFeatureEnabled, PHASE7_FLAGS } from "../services/feature-flag.service";
import { maintenanceForCustomer, maintenanceReason } from "../services/maintenance-intelligence.service";
import { rebookingSuggestionsFor } from "../services/rebooking-intelligence.service";
import { satisfactionSignalFor } from "../services/satisfaction-intelligence.service";
import prisma from "../lib/prisma";

/**
 * How much the top recommendation is actually worth believing.
 *
 * A repeat purchase is an observed fact about this customer; a category match in a catalogue where
 * 30 of 37 services share one category is barely an inference. These are not the same claim and must
 * not carry the same number.
 */
function confidenceFor(top: Recommendation | undefined): number {
  if (!top) return 0.2;
  if (top.reasonCodes.includes("REPEAT_SERVICE")) return 0.8;
  if (top.reasonCodes.includes("CATEGORY_AFFINITY")) return 0.45;
  return 0.3;
}

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

  /**
   * Service recommendations for the authenticated customer.
   *
   * Extends the existing customer-intel surface rather than adding a parallel recommendations API,
   * and reuses the `confidence` + `freshness` envelope every other response here carries. The
   * customer id comes from `requireAuth()` and from nowhere else — never a query parameter, never a
   * body field, never model output.
   *
   * Gated on AI_PERSONALIZED_RECOMMENDATIONS. The flag decides whether the feature is on; it grants
   * no permission of its own, and the ranking is deterministic whether or not a model is reachable.
   */
  .get("/recommendations", async ({ requireAuth, query }) => {
    const { userId } = requireAuth();
    if (!(await isFeatureEnabled(PHASE7_FLAGS.AI_PERSONALIZED_RECOMMENDATIONS, userId))) {
      return { success: true, data: { recommendations: [], enabled: false }, freshness: new Date().toISOString() };
    }
    const limit = Math.min(Math.max(Number((query as { limit?: string })?.limit ?? 5) || 5, 1), 10);
    const out = await recommendForCustomer(userId, limit);
    incCounter("customer_recommendations_generated_total", { rules: out.rulesVersion });
    return {
      success: true,
      data: {
        enabled: true,
        rulesVersion: out.rulesVersion,
        candidateCount: out.candidateCount,
        recommendations: out.recommendations.map((r) => ({
          ...r,
          reason: deterministicReason(r),
        })),
      },
      /**
       * Confidence follows the strongest evidence behind the top result, not the mere fact that a
       * result exists. A customer with one booking gets thirty category matches in this catalogue,
       * and reporting those at the same confidence as a repeat purchase would misrepresent them.
       */
      confidence: confidenceFor(out.recommendations[0]),
      freshness: new Date().toISOString(),
    };
  })

  /**
   * When the services this customer already buys are next expected.
   *
   * Lives on the existing customer-intel surface rather than behind a new maintenance API, and reads
   * the same `requireAuth()` actor everything else here does — a maintenance signal for the wrong
   * customer leaks their service history just as a recommendation would.
   *
   * The engine reports UNKNOWN for any service with no declared interval, and this endpoint passes
   * that through unchanged. A due date is only ever shown where a named admin has said what the
   * interval is; there is no default, and `policiesInForce` makes it visible how much of the answer
   * rests on a real policy rather than on silence.
   */
  .get("/maintenance", async ({ requireAuth }) => {
    const { userId } = requireAuth();
    if (!(await isFeatureEnabled(PHASE7_FLAGS.AI_MAINTENANCE_INTELLIGENCE, userId))) {
      return { success: true, data: { signals: [], enabled: false }, freshness: new Date().toISOString() };
    }
    const out = await maintenanceForCustomer(userId);
    incCounter("customer_maintenance_signals_total", { rules: out.rulesVersion });
    return {
      success: true,
      data: {
        enabled: true,
        rulesVersion: out.rulesVersion,
        policiesInForce: out.policiesInForce,
        signals: out.signals.map((s) => ({ ...s, reason: maintenanceReason(s) })),
      },
      /**
       * Confidence follows how much of the answer is backed by a declared interval. With no policy
       * in force every signal is UNKNOWN, and reporting that at high confidence would dress up an
       * absence of configuration as a finding.
       */
      confidence: out.policiesInForce === 0 ? 0.2 : 0.8,
      freshness: new Date().toISOString(),
    };
  })

  /**
   * Rebooking suggestions (Phase 7, Step 7B).
   *
   * A thin wrapper over `recommendForCustomer` — see `rebooking-intelligence.service.ts` for why
   * this deliberately does not re-score anything. Suggestions only: nothing in this handler, or
   * anything it calls, can create a booking. The customer must act on a suggestion explicitly
   * through the normal booking flow.
   */
  .get("/rebooking", async ({ requireAuth, query }) => {
    const { userId } = requireAuth();
    if (!(await isFeatureEnabled(PHASE7_FLAGS.AI_REBOOKING, userId))) {
      return { success: true, data: { suggestions: [], enabled: false }, freshness: new Date().toISOString() };
    }
    const limit = Math.min(Math.max(Number((query as { limit?: string })?.limit ?? 3) || 3, 1), 10);
    const out = await rebookingSuggestionsFor(userId, limit);
    incCounter("customer_rebooking_suggestions_total", { rules: out.rulesVersion });
    return {
      success: true,
      data: {
        enabled: true,
        rulesVersion: out.rulesVersion,
        candidateCount: out.candidateCount,
        suggestions: out.suggestions.map((s) => ({ ...s, reason: deterministicReason(s) })),
      },
      confidence: confidenceFor(out.suggestions[0]),
      freshness: out.generatedAt.toISOString(),
    };
  })

  /**
   * Satisfaction intelligence for one booking (Phase 7, Step 7C).
   *
   * Scoped to a single booking rather than the whole customer, and ownership-checked before any
   * data leaves this handler — a satisfaction signal for someone else's booking is exactly the kind
   * of leak the rest of this file already guards against for recommendations and maintenance.
   */
  .get(
    "/satisfaction/:bookingId",
    async ({ requireAuth, params, set }) => {
      const { userId } = requireAuth();
      if (!(await isFeatureEnabled(PHASE7_FLAGS.AI_SATISFACTION_INTELLIGENCE, userId))) {
        return { success: true, data: null, enabled: false, freshness: new Date().toISOString() };
      }

      const booking = await prisma.booking.findUnique({
        where: { id: params.bookingId },
        select: { userId: true },
      });
      if (!booking) {
        set.status = 404;
        return { success: false, error: "Booking not found", code: "NOT_FOUND" };
      }
      if (booking.userId !== userId) {
        set.status = 403;
        return { success: false, error: "Not your booking", code: "FORBIDDEN" };
      }

      const signal = await satisfactionSignalFor(params.bookingId);
      incCounter("customer_satisfaction_signals_total", {});
      return {
        success: true,
        data: { enabled: true, signal },
        /** Backed by real rows (rating, repeat count, tickets) whenever a rating exists; softer without one. */
        confidence: signal?.rating !== null ? 0.8 : 0.4,
        freshness: new Date().toISOString(),
      };
    },
  )

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
