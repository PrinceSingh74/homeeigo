/**
 * Phase 10 §11 — complaint / warranty-claim cases over HTTP.
 *
 *   customer  POST /api/bookings/:id/cases                     report an issue (idempotent per booking)
 *             GET  /api/bookings/:id/cases                     own cases (the assigned partner gets the partner view)
 *             POST /api/bookings/:id/cases/:caseId/evidence    attach evidence while the case is open
 *             POST /api/bookings/:id/cases/:caseId/evidence/photo               attach one photo (multipart `file`)
 *             GET  /api/bookings/:id/cases/:caseId/evidence/:evidenceId/media   a stored photo, for whoever may see that row
 *   admin     GET  /api/admin/cases/:id/evidence/:evidenceId/media              the same photo for the case team
 *   admin     GET  /api/admin/cases                            queue (state / type / slaBreached / bookingId)
 *             GET  /api/admin/cases/:id                        full detail: history, evidence, follow-ups, refunds
 *             POST /api/admin/cases/:id/transition             {to, reason, expectedVersion}
 *             POST /api/admin/cases/:id/resolve                {action, reason, refundPaise?, scheduledDate?, overrideReason?, expectedVersion?}
 *
 * The admin routes sit under /api/admin, so `admin-route-permissions` gates them (DISPUTES: READ for
 * reads, UPDATE for a transition, APPROVE for a decision — the support-ticket rules, quoted). Every
 * service error code maps to a status here, exhaustively: a code this table does not know is a 500,
 * never a success.
 */
import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import { adminRbacPlugin } from "../middleware/admin-rbac";
import { validate } from "../middleware/validation.middleware";
import { idParamSchema } from "../schemas/common.schema";
import { bookingCaseService, CASE_ERRORS, type CaseError } from "../services/booking-case.service";
import { CASE_CATEGORIES } from "../lib/service-warranty";
import { detectImageType } from "../lib/rating-photos";
import { CASE_STATES, RESOLVE_ACTIONS, type EvidenceInput } from "../lib/booking-case-policy";

/** Every code the service can return, with its status and a customer-safe message. Exhaustive by type. */
const CASE_HTTP: Record<CaseError, [number, string]> = {
  [CASE_ERRORS.NOT_FOUND]: [404, "Booking not found"],
  [CASE_ERRORS.CASE_NOT_FOUND]: [404, "Case not found"],
  [CASE_ERRORS.CASES_UNAVAILABLE]: [503, "Issue reporting is not available right now"],
  [CASE_ERRORS.BOOKING_NOT_COMPLETED]: [409, "An issue can be reported once the job is completed"],
  [CASE_ERRORS.COMPLAINT_WINDOW_CLOSED]: [409, "The window to report an issue on this booking has closed"],
  [CASE_ERRORS.COMPLAINT_WINDOW_NOT_CONFIGURED]: [409, "This service does not take issue reports after completion"],
  [CASE_ERRORS.INVALID_CATEGORY]: [400, "Unknown issue category"],
  [CASE_ERRORS.EVIDENCE_INVALID]: [400, "Evidence must be this booking's job evidence, your own media, or a note"],
  [CASE_ERRORS.EVIDENCE_LIMIT]: [400, "Too many evidence items for one case"],
  [CASE_ERRORS.CASE_CLOSED]: [409, "This case is closed"],
  [CASE_ERRORS.CASE_VERSION_CONFLICT]: [409, "The case changed since you loaded it"],
  [CASE_ERRORS.CASE_TRANSITION_FORBIDDEN]: [409, "That transition is not allowed from the current state"],
  [CASE_ERRORS.CASE_NOT_TRIAGED]: [409, "Triage the case before deciding it"],
  [CASE_ERRORS.ACTION_NOT_ALLOWED]: [409, "The booking's warranty does not allow this action — an override needs a reason"],
  [CASE_ERRORS.REASON_REQUIRED]: [400, "A reason is required"],
  [CASE_ERRORS.SCHEDULE_INVALID]: [400, "A future scheduledDate is required"],
  [CASE_ERRORS.SLOT_UNAVAILABLE]: [409, "That slot is not available"],
  [CASE_ERRORS.REWORK_FEE_NOT_CONFIGURED]: [409, "This service has no rework policy; a follow-up visit cannot be priced"],
  [CASE_ERRORS.OWNER_APPROVAL_REQUIRED]: [409, "A quoted rework needs an owner-approved price"],
  [CASE_ERRORS.REWORK_WINDOW_CLOSED]: [409, "The rework window for this booking has closed"],
  [CASE_ERRORS.REFUND_AMOUNT_INVALID]: [400, "refundPaise must be a positive integer"],
  [CASE_ERRORS.REFUND_EXCEEDS_REFUNDABLE]: [409, "The amount exceeds what is still refundable on this booking"],
  [CASE_ERRORS.NO_REFUNDABLE_PAYMENT]: [409, "This booking has no refundable payment"],
  [CASE_ERRORS.REFUND_IN_PROGRESS]: [409, "A refund for this case is already in progress"],
  [CASE_ERRORS.REFUND_FAILED]: [502, "The refund could not be completed"],
  [CASE_ERRORS.CASE_ALREADY_REFUNDED]: [409, "This case has already been refunded"],
};

function refuse(set: { status?: number | string }, r: { error: CaseError; data?: Record<string, unknown> }) {
  const entry = CASE_HTTP[r.error];
  const [status, message] = entry ?? [500, "Unable to process this case"];
  set.status = status;
  return { success: false as const, error: message, code: r.error, ...(r.data ? { details: r.data } : {}) };
}

const evidenceItem = t.Object({
  kind: t.Union([t.Literal("JOB_EVIDENCE"), t.Literal("CUSTOMER_MEDIA"), t.Literal("NOTE")]),
  jobEvidenceId: t.Optional(t.String({ maxLength: 100 })),
  mediaStorageKey: t.Optional(t.Union([t.String({ maxLength: 500 }), t.Null()])),
  mediaUrl: t.Optional(t.Union([t.String({ maxLength: 1000 }), t.Null()])),
  note: t.Optional(t.String({ maxLength: 2000 })),
});
type EvidenceBody = { kind: "JOB_EVIDENCE" | "CUSTOMER_MEDIA" | "NOTE"; jobEvidenceId?: string; mediaStorageKey?: string | null; mediaUrl?: string | null; note?: string };

/** The wire shape → the policy's discriminated union; a shape the service cannot judge fails there as EVIDENCE_INVALID. */
function toEvidence(items: EvidenceBody[] | undefined): EvidenceInput[] {
  return (items ?? []).map((e): EvidenceInput => {
    if (e.kind === "JOB_EVIDENCE") return { kind: "JOB_EVIDENCE", jobEvidenceId: e.jobEvidenceId ?? "" };
    if (e.kind === "CUSTOMER_MEDIA") return { kind: "CUSTOMER_MEDIA", mediaStorageKey: e.mediaStorageKey ?? null, mediaUrl: e.mediaUrl ?? null };
    return { kind: "NOTE", note: e.note ?? "" };
  });
}

const MAX_CASE_PHOTO_BYTES = 8 * 1024 * 1024;

/** A private photo: never cached by a shared cache, never sniffed into another type. */
function mediaResponse(r: { body: Buffer; mimeType: string }) {
  return new Response(new Uint8Array(r.body), {
    headers: { "Content-Type": r.mimeType, "Cache-Control": "private, max-age=300", "X-Content-Type-Options": "nosniff" },
  });
}

const customerCaseRoutes = new Elysia({ prefix: "/api/bookings" })
  .use(authPlugin)
  .post(
    "/:id/cases",
    async ({ requireAuth, params: rawParams, body, set }) => {
      const auth = requireAuth();
      const params = validate(idParamSchema, rawParams);
      const r = await bookingCaseService.openCase({
        bookingId: params.id, customerId: auth.userId, category: body.category, description: body.description ?? null,
        evidence: toEvidence(body.evidence), clientKey: body.clientKey ?? null,
      });
      if (!r.ok) return refuse(set, r);
      set.status = r.replayed ? 200 : 201;
      return { success: true as const, message: r.replayed ? "This issue is already open" : "Issue reported — our team will look into it", data: { replayed: r.replayed, case: r.case } };
    },
    {
      body: t.Object({
        category: t.String({ maxLength: 30 }),
        description: t.Optional(t.Union([t.String({ maxLength: 2000 }), t.Null()])),
        evidence: t.Optional(t.Array(evidenceItem, { maxItems: 20 })),
        clientKey: t.Optional(t.Union([t.String({ maxLength: 100 }), t.Null()])),
      }),
    },
  )
  .get("/:id/cases", async ({ requireAuth, params: rawParams, set }) => {
    const auth = requireAuth();
    const params = validate(idParamSchema, rawParams);
    const r = auth.providerId
      ? await bookingCaseService.listForBooking(params.id, { role: "PARTNER", providerId: auth.providerId })
      : await bookingCaseService.listForBooking(params.id, { role: "CUSTOMER", userId: auth.userId });
    if (!r.ok) return refuse(set, r);
    // Customer only: whether an issue can be reported now, so the app never offers a dead-end form.
    const report = auth.providerId ? null : await bookingCaseService.reportability(params.id, auth.userId);
    return { success: true as const, data: { available: r.available, cases: r.cases, categories: CASE_CATEGORIES, ...(report ? { report } : {}) } };
  })
  .post(
    "/:id/cases/:caseId/evidence/photo",
    async ({ requireAuth, params: rawParams, body, set }) => {
      const auth = requireAuth();
      const params = validate(idParamSchema, { id: rawParams.id });
      const file = body.file;
      if (!file || typeof file === "string" || file.size > MAX_CASE_PHOTO_BYTES) {
        set.status = 400;
        return { success: false as const, error: "Attach one JPG, PNG or WEBP photo of up to 8MB", code: "VALIDATION_ERROR" };
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      // The type comes from the bytes, never from what the client declared.
      const ext = detectImageType(buffer);
      if (!ext) {
        set.status = 400;
        return { success: false as const, error: "Only JPG, PNG or WEBP photos are allowed", code: "VALIDATION_ERROR" };
      }
      const r = await bookingCaseService.addCustomerPhoto({ bookingId: params.id, caseId: rawParams.caseId, customerId: auth.userId, body: buffer, ext });
      if (!r.ok) return refuse(set, r);
      set.status = 201;
      return { success: true as const, data: { case: r.case } };
    },
    { body: t.Object({ file: t.File({ maxSize: "8m" }) }) },
  )
  .get("/:id/cases/:caseId/evidence/:evidenceId/media", async ({ requireAuth, params, set }) => {
    const auth = requireAuth();
    const r = await bookingCaseService.evidenceMedia({
      caseId: params.caseId,
      evidenceId: Number(params.evidenceId),
      audience: auth.providerId ? { role: "PARTNER", providerId: auth.providerId } : { role: "CUSTOMER", userId: auth.userId },
    });
    if (!r.ok) return refuse(set, r);
    return mediaResponse(r);
  })
  .post(
    "/:id/cases/:caseId/evidence",
    async ({ requireAuth, params: rawParams, body, set }) => {
      const auth = requireAuth();
      const params = validate(idParamSchema, { id: rawParams.id });
      const r = await bookingCaseService.addEvidence({ bookingId: params.id, caseId: rawParams.caseId, customerId: auth.userId, evidence: toEvidence(body.evidence) });
      if (!r.ok) return refuse(set, r);
      return { success: true as const, data: { case: r.case } };
    },
    { body: t.Object({ evidence: t.Array(evidenceItem, { minItems: 1, maxItems: 20 }) }) },
  );

const isCaseState = (s: string): boolean => (CASE_STATES as readonly string[]).includes(s);
const isResolveAction = (s: string): s is (typeof RESOLVE_ACTIONS)[number] => (RESOLVE_ACTIONS as readonly string[]).includes(s);

const adminCaseRoutes = new Elysia({ prefix: "/api/admin" })
  // authPlugin BEFORE adminRbacPlugin, exactly as routes/admin.ts mounts them.
  .use(authPlugin)
  .use(adminRbacPlugin)
  .get("/cases", async ({ query, set }) => {
    if (query.state && !isCaseState(query.state)) {
      set.status = 400;
      return { success: false as const, error: "Unknown case state", code: "INVALID_STATE" };
    }
    const r = await bookingCaseService.adminList({
      state: query.state || undefined,
      type: query.type || undefined,
      bookingId: query.bookingId || undefined,
      slaBreached: query.slaBreached === "true" || query.slaBreached === "1",
      limit: query.limit ? Number(query.limit) : undefined,
      offset: query.offset ? Number(query.offset) : undefined,
    });
    if (!r.available) {
      set.status = 503;
      return { success: false as const, error: "Cases are not deployed on this database", code: CASE_ERRORS.CASES_UNAVAILABLE };
    }
    return { success: true as const, data: r };
  }, {
    query: t.Object({
      state: t.Optional(t.String({ maxLength: 30 })), type: t.Optional(t.String({ maxLength: 30 })), bookingId: t.Optional(t.String({ maxLength: 100 })),
      slaBreached: t.Optional(t.String({ maxLength: 5 })), limit: t.Optional(t.String({ maxLength: 4 })), offset: t.Optional(t.String({ maxLength: 8 })),
    }),
  })
  .get("/cases/:id", async ({ params, set }) => {
    const r = await bookingCaseService.adminDetail(params.id);
    if (!r.ok) return refuse(set, r);
    return { success: true as const, data: r };
  })
  .get("/cases/:id/evidence/:evidenceId/media", async ({ params, set }) => {
    const r = await bookingCaseService.evidenceMedia({ caseId: params.id, evidenceId: Number(params.evidenceId), audience: { role: "ADMIN" } });
    if (!r.ok) return refuse(set, r);
    return mediaResponse(r);
  })
  .post("/cases/:id/transition", async ({ params, body, requireAuth, set }) => {
    const auth = requireAuth();
    if (!isCaseState(body.to)) {
      set.status = 400;
      return { success: false as const, error: "Unknown case state", code: "INVALID_STATE" };
    }
    const r = await bookingCaseService.transition(params.id, auth.userId, { to: body.to, reason: body.reason, expectedVersion: body.expectedVersion });
    if (!r.ok) return refuse(set, r);
    return { success: true as const, data: { case: r.case } };
  }, { body: t.Object({ to: t.String({ maxLength: 30 }), reason: t.String({ maxLength: 1000 }), expectedVersion: t.Optional(t.Integer({ minimum: 1 })) }) })
  .post("/cases/:id/resolve", async ({ params, body, requireAuth, set }) => {
    const auth = requireAuth();
    if (!isResolveAction(body.action)) {
      set.status = 400;
      return { success: false as const, error: "Unknown resolution action", code: "INVALID_ACTION" };
    }
    const r = await bookingCaseService.resolve(params.id, auth.userId, {
      action: body.action, reason: body.reason, refundPaise: body.refundPaise, scheduledDate: body.scheduledDate, overrideReason: body.overrideReason, expectedVersion: body.expectedVersion,
    });
    if (!r.ok) return refuse(set, r);
    return { success: true as const, data: { replayed: r.replayed === true, state: r.state, resolution: r.resolution } };
  }, {
    body: t.Object({
      action: t.String({ maxLength: 20 }),
      reason: t.String({ maxLength: 1000 }),
      refundPaise: t.Optional(t.Integer({ minimum: 0 })),
      scheduledDate: t.Optional(t.String({ maxLength: 40 })),
      overrideReason: t.Optional(t.String({ maxLength: 1000 })),
      expectedVersion: t.Optional(t.Integer({ minimum: 1 })),
    }),
  });

export const bookingCasesRoutes = new Elysia().use(customerCaseRoutes).use(adminCaseRoutes);
