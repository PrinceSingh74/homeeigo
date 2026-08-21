import { Elysia, t } from "elysia";
import { adminRbacPlugin } from "../middleware/admin-rbac";
import { partnerLeadService } from "../services/partner-lead.service";
import { getAllowedLeadTransitions } from "../services/partner-lead-state-machine";
import { partnerAcquisitionAnalyticsService } from "../services/partner-acquisition-analytics.service";
import { partnerOnboardingService } from "../services/partner-onboarding.service";
import { markLeadDuplicate, mergeLeads, previewLeadMerge } from "../services/partner-lead-merge";
import { partnerAcquisitionQueueService } from "../services/partner-acquisition-queues.service";
import { acquisitionSpendService } from "../services/acquisition-spend.service";

function mapError(err: unknown, set: { status?: number | string }) {
  const message = err instanceof Error ? err.message : "Request failed";
  const [code, detail] = message.includes(":") ? message.split(":", 2) : ["INTERNAL", message];
  switch (code) {
    case "NOT_FOUND":
      set.status = 404;
      return { success: false, error: detail, code: "NOT_FOUND" };
    case "DUPLICATE":
      set.status = 409;
      return { success: false, error: detail, code: "DUPLICATE" };
    case "CONFLICT":
      set.status = 409;
      return { success: false, error: detail, code: "CONFLICT" };
    case "INVALID_TRANSITION":
      set.status = 400;
      return { success: false, error: detail, code: "INVALID_TRANSITION" };
    case "VALIDATION":
      set.status = 400;
      return { success: false, error: detail, code: "VALIDATION_ERROR" };
    default:
      console.error(err);
      set.status = 500;
      return { success: false, error: "Request failed", code: "INTERNAL_ERROR" };
  }
}

export const adminPartnerAcquisitionRoutes = new Elysia({ prefix: "/partner-acquisition" })
  .use(adminRbacPlugin)
  .get("/dashboard", async ({ query, set }) => {
    try {
      const range = query.range === "7d" || query.range === "90d" ? query.range : "30d";
      const data = await partnerAcquisitionAnalyticsService.getDashboard(range);
      return { success: true, data };
    } catch (err) {
      return mapError(err, set);
    }
  })
  .get("/sources", async ({ query, set }) => {
    try {
      const days = query.range === "7d" ? 7 : query.range === "90d" ? 90 : 30;
      const rangeEnd = new Date();
      const rangeStart = new Date(rangeEnd.getTime() - days * 86400_000);
      const data = await partnerAcquisitionAnalyticsService.sourcePerformance({ rangeStart, rangeEnd });
      return { success: true, data };
    } catch (err) {
      return mapError(err, set);
    }
  })
  .get("/leads", async ({ query, set }) => {
    try {
      const data = await partnerLeadService.listLeads({
        status: query.status as never,
        source: query.source as never,
        assignedToAdminId: query.assignedTo,
        city: query.city,
        zone: query.zone,
        skillInterest: query.skill,
        campaign: query.campaign,
        minScore: query.minScore ? Number(query.minScore) : undefined,
        maxScore: query.maxScore ? Number(query.maxScore) : undefined,
        createdFrom: query.createdFrom,
        createdTo: query.createdTo,
        lastActivityFrom: query.lastActivityFrom,
        lastActivityTo: query.lastActivityTo,
        followUp: query.followUp as "today" | "overdue" | "upcoming" | "tomorrow" | "none" | undefined,
        stalled: query.stalled === "true" || query.stalled === "1",
        noNextAction: query.noNextAction === "true" || query.noNextAction === "1",
        includeMerged: query.includeMerged === "true",
        search: query.search,
        page: query.page ? Number(query.page) : 1,
        limit: query.limit ? Number(query.limit) : 20,
      });
      return { success: true, data };
    } catch (err) {
      return mapError(err, set);
    }
  })
  .post(
    "/leads/check-duplicates",
    async ({ body, set }) => {
      try {
        const matches = await partnerLeadService.checkDuplicates(body);
        return { success: true, data: { matches } };
      } catch (err) {
        return mapError(err, set);
      }
    },
    { body: t.Object({ phone: t.Optional(t.String()), email: t.Optional(t.String()) }) },
  )
  .post(
    "/leads",
    async ({ body, set, requireAdminContext }) => {
      try {
        const admin = requireAdminContext();
        const lead = await partnerLeadService.createLead(body as never, admin.adminId);
        set.status = 201;
        return { success: true, data: lead };
      } catch (err) {
        return mapError(err, set);
      }
    },
    {
      body: t.Object({
        name: t.String(),
        phone: t.String(),
        email: t.Optional(t.String()),
        source: t.String(),
        sourceCampaign: t.Optional(t.String()),
        channel: t.Optional(t.String()),
        skillInterest: t.Optional(t.String()),
        city: t.Optional(t.String()),
        zone: t.Optional(t.String()),
        notes: t.Optional(t.String()),
        assignedToAdminId: t.Optional(t.String()),
        forceCreate: t.Optional(t.Boolean()),
        duplicateJustification: t.Optional(t.String()),
      }),
    },
  )
  .get("/leads/:id", async ({ params, set }) => {
    try {
      const data = await partnerLeadService.getLeadDetail(params.id);
      return { success: true, data };
    } catch (err) {
      return mapError(err, set);
    }
  })
  .get("/leads/:id/transitions", async ({ params, set }) => {
    try {
      const lead = await partnerLeadService.getLeadDetail(params.id);
      const allowed = getAllowedLeadTransitions(lead.status);
      return { success: true, data: { current: lead.status, allowed } };
    } catch (err) {
      return mapError(err, set);
    }
  })
  .patch(
    "/leads/:id/status",
    async ({ params, body, set, requireAdminContext }) => {
      try {
        const admin = requireAdminContext();
        const data = await partnerLeadService.transitionStatus(params.id, body.status as never, admin.adminId, {
          reason: body.reason,
        });
        return { success: true, data };
      } catch (err) {
        return mapError(err, set);
      }
    },
    { body: t.Object({ status: t.String(), reason: t.Optional(t.String()) }) },
  )
  .patch(
    "/leads/:id/assign",
    async ({ params, body, set, requireAdminContext }) => {
      try {
        const admin = requireAdminContext();
        const data = await partnerLeadService.assignLead(params.id, body.assignedToAdminId, admin.adminId);
        return { success: true, data };
      } catch (err) {
        return mapError(err, set);
      }
    },
    { body: t.Object({ assignedToAdminId: t.String() }) },
  )
  .patch(
    "/leads/:id/follow-up",
    async ({ params, body, set, requireAdminContext }) => {
      try {
        const admin = requireAdminContext();
        const data = await partnerLeadService.setFollowUp(
          params.id,
          { nextFollowUpAt: new Date(body.nextFollowUpAt), followUpReason: body.followUpReason },
          admin.adminId,
        );
        return { success: true, data };
      } catch (err) {
        return mapError(err, set);
      }
    },
    {
      body: t.Object({
        nextFollowUpAt: t.String(),
        followUpReason: t.Optional(t.String()),
      }),
    },
  )
  .patch(
    "/leads/:id/notes",
    async ({ params, body, set, requireAdminContext }) => {
      try {
        const admin = requireAdminContext();
        const data = await partnerLeadService.updateNotes(params.id, body.notes, admin.adminId);
        return { success: true, data };
      } catch (err) {
        return mapError(err, set);
      }
    },
    { body: t.Object({ notes: t.String() }) },
  )
  .post(
    "/leads/:id/activity",
    async ({ params, body, set, requireAdminContext }) => {
      try {
        const admin = requireAdminContext();
        const data = await partnerLeadService.logActivity(params.id, {
          type: body.type as never,
          title: body.title,
          description: body.description,
          actorId: admin.adminId,
        });
        return { success: true, data };
      } catch (err) {
        return mapError(err, set);
      }
    },
    {
      body: t.Object({
        type: t.String(),
        title: t.String(),
        description: t.Optional(t.String()),
      }),
    },
  )
  .post(
    "/leads/:id/start-application",
    async ({ params, set, requireAdminContext }) => {
      try {
        const admin = requireAdminContext();
        const data = await partnerLeadService.startApplication(params.id, admin.adminId);
        return { success: true, data };
      } catch (err) {
        return mapError(err, set);
      }
    },
  )
  .get("/applications/:providerId/checklist", async ({ params, set }) => {
    try {
      const data = await partnerOnboardingService.getActivationChecklist(params.providerId);
      return { success: true, data };
    } catch (err) {
      return mapError(err, set);
    }
  })
  .post(
    "/applications/:providerId/background-check/verify",
    async ({ params, body, set, requireAdminContext }) => {
      try {
        const admin = requireAdminContext();
        const data = await partnerOnboardingService.verifyBackgroundCheck(
          params.providerId,
          admin.adminId,
          body.notes,
        );
        return { success: true, data };
      } catch (err) {
        return mapError(err, set);
      }
    },
    { body: t.Object({ notes: t.Optional(t.String()) }) },
  )
  .get("/leads/:id/merge-preview", async ({ params, query, set }) => {
    try {
      const duplicateId = typeof query.duplicateId === "string" ? query.duplicateId : "";
      if (!duplicateId) {
        set.status = 400;
        return { success: false, error: "duplicateId is required", code: "VALIDATION_ERROR" };
      }
      const data = await previewLeadMerge(params.id, duplicateId);
      return { success: true, data };
    } catch (err) {
      return mapError(err, set);
    }
  })
  .post(
    "/leads/:id/mark-duplicate",
    async ({ params, body, set, requireAdminContext }) => {
      try {
        const admin = requireAdminContext();
        const data = await markLeadDuplicate(params.id, body.duplicateOfLeadId, admin.adminId, body.reason);
        return { success: true, data };
      } catch (err) {
        return mapError(err, set);
      }
    },
    { body: t.Object({ duplicateOfLeadId: t.String(), reason: t.String() }) },
  )
  .post(
    "/leads/:id/merge",
    async ({ params, body, set, requireAdminContext }) => {
      try {
        const admin = requireAdminContext();
        const data = await mergeLeads(params.id, body.duplicateLeadId, admin.adminId, {
          reason: body.reason,
          resolutions: body.resolutions as never,
        });
        return { success: true, data };
      } catch (err) {
        return mapError(err, set);
      }
    },
    {
      body: t.Object({
        duplicateLeadId: t.String(),
        reason: t.String(),
        resolutions: t.Optional(t.Record(t.String(), t.String())),
      }),
    },
  )
  .get("/applications", async ({ query, set }) => {
    try {
      const data = await partnerAcquisitionQueueService.listApplications({
        pipeline: query.pipeline as never,
        search: query.search,
        page: query.page ? Number(query.page) : 1,
        limit: query.limit ? Number(query.limit) : 30,
      });
      return { success: true, data };
    } catch (err) {
      return mapError(err, set);
    }
  })
  .get("/verification", async ({ query, set }) => {
    try {
      const data = await partnerAcquisitionQueueService.listVerification({
        status: query.status as never,
        page: query.page ? Number(query.page) : 1,
        limit: query.limit ? Number(query.limit) : 30,
      });
      return { success: true, data };
    } catch (err) {
      return mapError(err, set);
    }
  })
  .get("/approvals", async ({ query, set }) => {
    try {
      const data = await partnerAcquisitionQueueService.listApprovals({
        status: query.status as never,
        page: query.page ? Number(query.page) : 1,
        limit: query.limit ? Number(query.limit) : 30,
      });
      return { success: true, data };
    } catch (err) {
      return mapError(err, set);
    }
  })
  .get("/spend", async ({ query, set }) => {
    try {
      const data = await acquisitionSpendService.list({
        source: query.source as never,
        campaign: query.campaign,
      });
      return { success: true, data };
    } catch (err) {
      return mapError(err, set);
    }
  })
  .post(
    "/spend",
    async ({ body, set, requireAdminContext }) => {
      try {
        const admin = requireAdminContext();
        const data = await acquisitionSpendService.create(body as never, admin.adminId);
        set.status = 201;
        return { success: true, data };
      } catch (err) {
        return mapError(err, set);
      }
    },
    {
      body: t.Object({
        source: t.String(),
        campaign: t.Optional(t.String()),
        channel: t.Optional(t.String()),
        periodStart: t.String(),
        periodEnd: t.String(),
        amount: t.Number(),
        currency: t.Optional(t.String()),
        notes: t.Optional(t.String()),
      }),
    },
  )
  .patch(
    "/spend/:id",
    async ({ params, body, set }) => {
      try {
        const data = await acquisitionSpendService.update(params.id, body as never);
        return { success: true, data };
      } catch (err) {
        return mapError(err, set);
      }
    },
    {
      body: t.Object({
        source: t.Optional(t.String()),
        campaign: t.Optional(t.String()),
        channel: t.Optional(t.String()),
        periodStart: t.Optional(t.String()),
        periodEnd: t.Optional(t.String()),
        amount: t.Optional(t.Number()),
        notes: t.Optional(t.String()),
      }),
    },
  )
  .delete("/spend/:id", async ({ params, set }) => {
    try {
      const data = await acquisitionSpendService.remove(params.id);
      return { success: true, data };
    } catch (err) {
      return mapError(err, set);
    }
  });
