/**
 * Phase 15.1 — customer funnel event ingest.
 *
 * Public for the browse events (view / click / variant / option / add-on / booking started).
 * Auth is optional: a signed-in actor is stamped; an anonymous session is identified only by
 * `sessionId`. Backend-authoritative names (quote, checkout, booking created/completed/cancelled,
 * repeat) are refused here — they are written by `recordAuthoritativeEvent` from the service
 * that already committed the fact.
 *
 * Prefix is `/api/analytics/events`, not `/api/analytics`, so this is not the admin warehouse
 * panel (`routes/analytics.ts`) and does not require ADMIN.
 */
import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import prisma from "../lib/prisma";
import { ingestClientEvent } from "../services/analytics-events.service";

const ERROR_STATUS: Record<string, number> = {
  MALFORMED_EVENT: 400,
  UNAUTHORIZED_EVENT: 403,
  SERVICE_NOT_FOUND: 400,
  SERVICE_NOT_VISIBLE: 400,
  SERVICE_VERSION_NOT_FOUND: 400,
  VARIANT_NOT_ON_SERVICE: 400,
  ADDON_NOT_ON_SERVICE: 400,
  OPTION_NOT_ON_SERVICE: 400,
  BOOKING_NOT_FOUND: 400,
  BOOKING_SERVICE_MISMATCH: 400,
  BOOKING_ACTOR_MISMATCH: 403,
};

export const analyticsEventsRoutes = new Elysia({ prefix: "/api/analytics/events" })
  .use(authPlugin)
  .post(
    "/",
    async ({ body, authUser, set }) => {
      const actor = authUser
        ? await prisma.user.findUnique({
            where: { id: authUser.userId },
            select: { id: true, dataOrigin: true },
          })
        : null;
      const result = await ingestClientEvent(
        {
          eventId: body.eventId,
          eventName: body.eventName,
          occurredAt: body.occurredAt,
          sessionId: body.sessionId,
          serviceId: body.serviceId,
          serviceVersionId: body.serviceVersionId,
          variantId: body.variantId,
          optionId: body.optionId,
          addonId: body.addonId,
          bookingId: body.bookingId,
          quoteFingerprint: body.quoteFingerprint,
          source: body.source,
          platform: body.platform,
          metadata: body.metadata,
        },
        actor ? { userId: actor.id, dataOrigin: actor.dataOrigin } : null,
      );
      if (!result.ok) {
        set.status = ERROR_STATUS[result.error] ?? 400;
        return { success: false, error: result.error, code: result.error, detail: result.detail };
      }
      set.status = result.duplicate ? 200 : 201;
      return { success: true, data: { id: result.id, duplicate: result.duplicate } };
    },
    {
      body: t.Object({
        eventId: t.String(),
        eventName: t.String(),
        occurredAt: t.Optional(t.String()),
        sessionId: t.Optional(t.String()),
        serviceId: t.Optional(t.String()),
        serviceVersionId: t.Optional(t.Number()),
        variantId: t.Optional(t.String()),
        optionId: t.Optional(t.String()),
        addonId: t.Optional(t.String()),
        bookingId: t.Optional(t.String()),
        quoteFingerprint: t.Optional(t.String()),
        source: t.String(),
        platform: t.String(),
        metadata: t.Optional(t.Record(t.String(), t.Unknown())),
      }),
    },
  );
