import { Elysia, t } from "elysia";
import { MERGE_FIELDS } from "../services/partner-lead-merge";
import type { PartnerLeadStatus, PartnerLeadSource, PartnerLeadActivityType } from "@prisma/client";
import type { ApplicationPipeline } from "../services/partner-acquisition-queues.service";
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

/**
 * Request schemas derived from the real domain unions.
 *
 * Twelve call sites in this module pushed raw request values into typed service parameters with
 * `as never`, and the GET routes declared no query schema at all — so any string reached filters
 * and enum columns, failing at the query as a 500 instead of at the edge as a 400. (The tell was
 * `followUp` in /leads, which was already given a proper union while its neighbours were not.)
 *
 * `as const satisfies` ties each list to its source union, so adding a member without updating the
 * route is a compile error rather than a value the API silently rejects at runtime.
 */
const LEAD_STATUSES = [
  "NEW", "CONTACTED", "INTERESTED", "APPLICATION_STARTED", "APPLICATION_SUBMITTED",
  "KYC_PENDING", "VERIFICATION", "TRAINING", "APPROVED", "ACTIVATED",
  "DORMANT", "REJECTED", "DUPLICATE", "INVALID", "WITHDRAWN",
] as const satisfies readonly PartnerLeadStatus[];

const LEAD_SOURCES = [
  "APNA", "JOBHAI", "REFERRAL", "RWA", "CONTRACTOR", "LOCAL_SHOP",
  "DIRECT", "SOCIAL", "CAMPAIGN", "PARTNER_REFERRAL",
] as const satisfies readonly PartnerLeadSource[];

const LEAD_ACTIVITY_TYPES = [
  "NOTE", "CALL", "MESSAGE", "STATUS_CHANGE", "ASSIGNMENT", "FOLLOW_UP",
  "DUPLICATE_CHECK", "APPLICATION_LINKED", "MERGE", "SYSTEM",
] as const satisfies readonly PartnerLeadActivityType[];

const APPLICATION_PIPELINES = [
  "started", "submitted", "kyc", "assessment", "training", "ready", "rejected", "changes_requested",
] as const satisfies readonly ApplicationPipeline[];

const u = (values: readonly string[]) => t.Union(values.map((v) => t.Literal(v)));

const LEAD_STATUS_SCHEMA = u(LEAD_STATUSES);
const LEAD_SOURCE_SCHEMA = u(LEAD_SOURCES);
const LEAD_ACTIVITY_TYPE_SCHEMA = u(LEAD_ACTIVITY_TYPES);
const APPLICATION_PIPELINE_SCHEMA = u(APPLICATION_PIPELINES);
const VERIFICATION_STATUS_SCHEMA = u(["pending", "verified", "needs_attention", "rejected"]);
const APPROVAL_STATUS_SCHEMA = u(["ready", "pending", "approved", "rejected", "changes_requested"]);

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
        status: query.status,
        source: query.source,
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
        followUp: query.followUp,
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
  }, {
    query: t.Object({
      status: t.Optional(LEAD_STATUS_SCHEMA),
      source: t.Optional(LEAD_SOURCE_SCHEMA),
      assignedTo: t.Optional(t.String()),
      city: t.Optional(t.String()),
      zone: t.Optional(t.String()),
      skill: t.Optional(t.String()),
      campaign: t.Optional(t.String()),
      minScore: t.Optional(t.String()),
      maxScore: t.Optional(t.String()),
      createdFrom: t.Optional(t.String()),
      createdTo: t.Optional(t.String()),
      lastActivityFrom: t.Optional(t.String()),
      lastActivityTo: t.Optional(t.String()),
      followUp: t.Optional(t.Union([
        t.Literal("today"), t.Literal("overdue"), t.Literal("upcoming"),
        t.Literal("tomorrow"), t.Literal("none"),
      ])),
      stalled: t.Optional(t.String()),
      noNextAction: t.Optional(t.String()),
      includeMerged: t.Optional(t.String()),
      search: t.Optional(t.String()),
      page: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
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
        const lead = await partnerLeadService.createLead(body, admin.adminId);
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
        source: LEAD_SOURCE_SCHEMA,
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
        const data = await partnerLeadService.transitionStatus(params.id, body.status, admin.adminId, {
          reason: body.reason,
        });
        return { success: true, data };
      } catch (err) {
        return mapError(err, set);
      }
    },
    { body: t.Object({ status: LEAD_STATUS_SCHEMA, reason: t.Optional(t.String()) }) },
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
          type: body.type,
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
        type: LEAD_ACTIVITY_TYPE_SCHEMA,
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
          resolutions: body.resolutions,
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
        // Keys and values both constrained: `MergeResolutions` is
        // `Partial<Record<MergeFieldKey, "primary" | "duplicate">>`, so a free-form
        // `Record<string, string>` forced in with `as never` could carry an unknown field or an
        // invalid choice into a merge that rewrites lead data.
        resolutions: t.Optional(
          t.Partial(
            t.Object(
              Object.fromEntries(
                MERGE_FIELDS.map((f) => [f, t.Union([t.Literal("primary"), t.Literal("duplicate")])]),
              ),
            ),
          ),
        ),
      }),
    },
  )
  .get("/applications", async ({ query, set }) => {
    try {
      const data = await partnerAcquisitionQueueService.listApplications({
        pipeline: query.pipeline,
        search: query.search,
        page: query.page ? Number(query.page) : 1,
        limit: query.limit ? Number(query.limit) : 30,
      });
      return { success: true, data };
    } catch (err) {
      return mapError(err, set);
    }
  }, {
    query: t.Object({
      pipeline: t.Optional(APPLICATION_PIPELINE_SCHEMA),
      search: t.Optional(t.String()),
      page: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
  })
  .get("/verification", async ({ query, set }) => {
    try {
      const data = await partnerAcquisitionQueueService.listVerification({
        status: query.status,
        page: query.page ? Number(query.page) : 1,
        limit: query.limit ? Number(query.limit) : 30,
      });
      return { success: true, data };
    } catch (err) {
      return mapError(err, set);
    }
  }, {
    query: t.Object({
      status: t.Optional(VERIFICATION_STATUS_SCHEMA),
      search: t.Optional(t.String()),
      page: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
  })
  .get("/approvals", async ({ query, set }) => {
    try {
      const data = await partnerAcquisitionQueueService.listApprovals({
        status: query.status,
        page: query.page ? Number(query.page) : 1,
        limit: query.limit ? Number(query.limit) : 30,
      });
      return { success: true, data };
    } catch (err) {
      return mapError(err, set);
    }
  }, {
    query: t.Object({
      status: t.Optional(APPROVAL_STATUS_SCHEMA),
      search: t.Optional(t.String()),
      page: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
  })
  .get("/spend", async ({ query, set }) => {
    try {
      const data = await acquisitionSpendService.list({
        source: query.source,
        campaign: query.campaign,
      });
      return { success: true, data };
    } catch (err) {
      return mapError(err, set);
    }
  }, {
    query: t.Object({
      source: t.Optional(LEAD_SOURCE_SCHEMA),
      campaign: t.Optional(t.String()),
    }),
  })
  .post(
    "/spend",
    async ({ body, set, requireAdminContext }) => {
      try {
        const admin = requireAdminContext();
        const data = await acquisitionSpendService.create(body, admin.adminId);
        set.status = 201;
        return { success: true, data };
      } catch (err) {
        return mapError(err, set);
      }
    },
    {
      body: t.Object({
        source: LEAD_SOURCE_SCHEMA,
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
        const data = await acquisitionSpendService.update(params.id, body);
        return { success: true, data };
      } catch (err) {
        return mapError(err, set);
      }
    },
    {
      body: t.Object({
        source: t.Optional(LEAD_SOURCE_SCHEMA),
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
