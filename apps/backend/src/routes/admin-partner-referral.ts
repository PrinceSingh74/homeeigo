import { Elysia, t } from "elysia";
import { adminRbacPlugin } from "../middleware/admin-rbac";
import { partnerReferralService } from "../services/partner-referral.service";

function mapError(err: unknown, set: { status?: number | string }) {
  const message = err instanceof Error ? err.message : "Request failed";
  const [code, detail] = message.includes(":") ? message.split(":", 2) : ["INTERNAL", message];
  switch (code) {
    case "NOT_FOUND":
      set.status = 404;
      return { success: false, error: detail, code: "NOT_FOUND" };
    case "CONFLICT":
      set.status = 409;
      return { success: false, error: detail, code: "CONFLICT" };
    case "VALIDATION":
      set.status = 400;
      return { success: false, error: detail, code: "VALIDATION_ERROR" };
    default:
      console.error(err);
      set.status = 500;
      return { success: false, error: "Request failed", code: "INTERNAL_ERROR" };
  }
}

export const adminPartnerReferralRoutes = new Elysia({ prefix: "/partner-referrals" })
  .use(adminRbacPlugin)
  .get("/overview", async () => {
    const data = await partnerReferralService.adminOverview();
    return { success: true, data };
  })
  .get("/queue", async ({ query }) => {
    const data = await partnerReferralService.adminList({
      status: typeof query.status === "string" ? query.status : undefined,
      review: typeof query.review === "string" ? query.review : undefined,
      city: typeof query.city === "string" ? query.city : undefined,
      campaign: typeof query.campaign === "string" ? query.campaign : undefined,
      source: typeof query.source === "string" ? query.source : undefined,
      from: typeof query.from === "string" ? query.from : undefined,
      to: typeof query.to === "string" ? query.to : undefined,
      risk: typeof query.risk === "string" ? query.risk : undefined,
      page: query.page ? Number(query.page) : undefined,
      limit: query.limit ? Number(query.limit) : undefined,
    });
    return { success: true, data };
  })
  .get("/:id", async ({ params, set }) => {
    const data = await partnerReferralService.adminDetail(params.id);
    if (!data) {
      set.status = 404;
      return { success: false, error: "Referral not found", code: "NOT_FOUND" };
    }
    return { success: true, data };
  })
  .post(
    "/:id/action",
    async ({ params, body, adminContext, set }) => {
      try {
        const actorId = adminContext?.userId ?? "admin";
        const data = await partnerReferralService.adminAction(
          params.id,
          body.action,
          actorId,
          body.reason,
        );
        return { success: true, data };
      } catch (err) {
        return mapError(err, set);
      }
    },
    {
      body: t.Object({
        action: t.Union([
          t.Literal("review"),
          t.Literal("approve"),
          t.Literal("block"),
          t.Literal("release"),
          t.Literal("hold"),
        ]),
        reason: t.Optional(t.String()),
      }),
    },
  );
