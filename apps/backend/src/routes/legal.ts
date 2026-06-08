import { Elysia, t } from "elysia";
import { ConsentSource } from "@prisma/client";
import { authPlugin } from "../plugins/auth.plugin";
import { consentService } from "../services/consent.service";
import { getClientIp } from "../lib/fraud-context";

export const legalRoutes = new Elysia({ prefix: "/api/legal" })
  .use(authPlugin)
  .get("/policies", async () => {
    await consentService.ensurePolicyVersionsSeeded();
    return { success: true, data: { policies: consentService.listCurrentPolicies() } };
  })
  .post(
    "/consent/cookies",
    async ({ body, request, authUser }) => {
      await consentService.recordCookieConsent({
        userId: authUser?.userId,
        granted: body.granted,
        ipAddress: getClientIp(request),
        userAgent: request.headers.get("user-agent") ?? undefined,
      });
      return { success: true, message: "Cookie preference recorded" };
    },
    {
      body: t.Object({ granted: t.Boolean() }),
    },
  )
  .post(
    "/consent",
    async ({ requireAuth, body, request }) => {
      const { userId } = requireAuth();
      await consentService.recordConsents({
        userId,
        policies: body.policies as ("TERMS" | "PRIVACY" | "COOKIES" | "REFUND")[],
        source: (body.source as ConsentSource) ?? "SETTINGS",
        ipAddress: getClientIp(request),
        userAgent: request.headers.get("user-agent") ?? undefined,
      });
      return { success: true, message: "Consent recorded" };
    },
    {
      body: t.Object({
        policies: t.Array(t.String()),
        source: t.Optional(t.String()),
      }),
    },
  );
