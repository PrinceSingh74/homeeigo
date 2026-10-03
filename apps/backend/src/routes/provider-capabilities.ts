/**
 * Phase 11 — partner-side capability routes (declare / request / withdraw / read own profile).
 *
 * A partner can only ever create claims: DECLARED rows and REQUESTED service capabilities. Body
 * schemas below declare only fact fields; status, verifier, source and data_origin are not
 * accepted from anyone and are set by the service. The error table maps every service code; an
 * unknown code is a 500, never `success: true`.
 */
import { Elysia, t } from "elysia";
import { authPlugin } from "../plugins/auth.plugin";
import {
  CAPABILITY_ERROR_STATUS,
  isCapabilityKind,
  providerCapabilityService,
  type Result,
} from "../services/provider-capability.service";

type SetLike = { status?: number | string };

export function capabilityResponse<T>(set: SetLike, r: Result<T>) {
  if (r.ok) return { success: true as const, data: r.data };
  const status = (CAPABILITY_ERROR_STATUS as Record<string, number | undefined>)[r.error];
  if (!status) {
    set.status = 500;
    return { success: false as const, error: "Unexpected capability outcome", code: "INTERNAL_ERROR" };
  }
  set.status = status;
  return {
    success: false as const,
    error: r.detail ?? r.error,
    code: r.error,
    ...(r.blocking ? { data: { blocking: r.blocking } } : {}),
  };
}

const optStr = t.Optional(t.Union([t.String({ maxLength: 300 }), t.Null()]));

export const providerCapabilitiesRoutes = new Elysia({ prefix: "/api/providers/me/capabilities" })
  .use(authPlugin)
  .get("/", async ({ requireProvider, set }) => {
    const { providerId } = requireProvider();
    const profile = await providerCapabilityService.getProviderCapabilityProfile(providerId, new Date(), "partner");
    if (!profile.ok) return capabilityResponse(set, profile);
    const catalogue = await providerCapabilityService.listSkills({ activeOnly: true });
    return { success: true, data: { ...profile.data, skillCatalogue: catalogue.ok ? catalogue.data.skills : [] } };
  })
  .post("/skills", async ({ requireProvider, body, set }) => {
    const u = requireProvider();
    return capabilityResponse(set, await providerCapabilityService.declare(u.providerId, u.userId, "skills", { skillCode: body.skillCode, level: body.level ?? null }));
  }, { body: t.Object({ skillCode: t.String({ maxLength: 80 }), level: optStr }) })
  .post("/certifications", async ({ requireProvider, body, set }) => {
    const u = requireProvider();
    return capabilityResponse(set, await providerCapabilityService.declare(u.providerId, u.userId, "certifications", {
      certificationType: body.certificationType, issuer: body.issuer, referenceNumber: body.referenceNumber,
      issuedAt: body.issuedAt, expiresAt: body.expiresAt, documentId: body.documentId,
    }));
  }, { body: t.Object({ certificationType: t.String({ maxLength: 80 }), issuer: optStr, referenceNumber: optStr, issuedAt: optStr, expiresAt: optStr, documentId: optStr }) })
  .post("/equipment", async ({ requireProvider, body, set }) => {
    const u = requireProvider();
    return capabilityResponse(set, await providerCapabilityService.declare(u.providerId, u.userId, "equipment", {
      equipmentType: body.equipmentType, ownership: body.ownership, operational: body.operational, note: body.note,
    }));
  }, { body: t.Object({ equipmentType: t.String({ maxLength: 80 }), ownership: optStr, operational: optStr, note: optStr }) })
  .post("/insurance", async ({ requireProvider, body, set }) => {
    const u = requireProvider();
    return capabilityResponse(set, await providerCapabilityService.declare(u.providerId, u.userId, "insurance", {
      insuranceType: body.insuranceType, insurer: body.insurer, policyReference: body.policyReference,
      effectiveFrom: body.effectiveFrom, expiresAt: body.expiresAt, documentId: body.documentId,
    }));
  }, { body: t.Object({ insuranceType: t.String({ maxLength: 80 }), insurer: optStr, policyReference: optStr, effectiveFrom: optStr, expiresAt: t.String({ maxLength: 40 }), documentId: optStr }) })
  .post("/languages", async ({ requireProvider, body, set }) => {
    const u = requireProvider();
    return capabilityResponse(set, await providerCapabilityService.declare(u.providerId, u.userId, "languages", { languageCode: body.languageCode, proficiency: body.proficiency }));
  }, { body: t.Object({ languageCode: t.String({ maxLength: 8 }), proficiency: optStr }) })
  /** Request to perform a catalogue service. Always REQUESTED; an admin approves it to ACTIVE. */
  .post("/services", async ({ requireProvider, body, set }) => {
    const u = requireProvider();
    return capabilityResponse(set, await providerCapabilityService.requestService(u.providerId, u.userId, body.serviceId, new Date(), body.note));
  }, { body: t.Object({ serviceId: t.String({ maxLength: 64 }), note: t.Optional(t.String({ maxLength: 300 })) }) })
  /** Edit the facts of an own certification / insurance claim. VERIFIED or REVOKED → 409 CAPABILITY_LOCKED. */
  .patch("/:kind/:rowId", async ({ requireProvider, params, body, set }) => {
    const u = requireProvider();
    const rowId = Number(params.rowId);
    if (!isCapabilityKind(params.kind) || !Number.isSafeInteger(rowId) || rowId <= 0) {
      set.status = 404;
      return { success: false, error: "Not found", code: "NOT_FOUND" };
    }
    return capabilityResponse(set, await providerCapabilityService.partnerEdit(u.providerId, u.userId, params.kind, rowId, body));
  }, {
    params: t.Object({ kind: t.String(), rowId: t.String() }),
    body: t.Object({ issuer: optStr, referenceNumber: optStr, issuedAt: optStr, expiresAt: optStr, insurer: optStr, policyReference: optStr, effectiveFrom: optStr, documentId: optStr }),
  })
  /** Withdraw an own claim — DECLARED (or REQUESTED service) rows only. */
  .delete("/:kind/:rowId", async ({ requireProvider, params, set }) => {
    const u = requireProvider();
    const rowId = Number(params.rowId);
    const kind = params.kind;
    if ((!isCapabilityKind(kind) && kind !== "services") || !Number.isSafeInteger(rowId) || rowId <= 0) {
      set.status = 404;
      return { success: false, error: "Not found", code: "NOT_FOUND" };
    }
    return capabilityResponse(set, await providerCapabilityService.partnerDelete(u.providerId, u.userId, kind, rowId));
  }, { params: t.Object({ kind: t.String(), rowId: t.String() }) });
