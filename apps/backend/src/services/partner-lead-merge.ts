import type { PartnerLead, PartnerLeadSource, PartnerLeadStatus, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { sanitizeUserInput } from "../utils/sanitizer";
import { partnerAcquisitionEvents } from "./partner-acquisition-events.service";
import { userPiiService } from "./user-pii.service";

export const MERGE_FIELDS = [
  "name",
  "phone",
  "email",
  "skillInterest",
  "city",
  "zone",
  "source",
  "sourceCampaign",
  "assignedToAdminId",
  "notes",
] as const;

export type MergeFieldKey = (typeof MERGE_FIELDS)[number];
export type MergeFieldChoice = "primary" | "duplicate";
export type MergeResolutions = Partial<Record<MergeFieldKey, MergeFieldChoice>>;

export type MergeFieldPreview = {
  key: MergeFieldKey;
  label: string;
  primaryValue: string | null;
  duplicateValue: string | null;
  shared: boolean;
  conflict: boolean;
  suggested: MergeFieldChoice;
  critical: boolean;
};

const FIELD_LABELS: Record<MergeFieldKey, string> = {
  name: "Name",
  phone: "Phone",
  email: "Email",
  skillInterest: "Skill",
  city: "City",
  zone: "Zone",
  source: "Source",
  sourceCampaign: "Campaign",
  assignedToAdminId: "Assignee",
  notes: "Notes",
};

const CRITICAL_FIELDS: MergeFieldKey[] = ["phone", "email"];

function asText(value: unknown): string | null {
  if (value == null) return null;
  const text = String(value).trim();
  return text.length ? text : null;
}

function digits(phone: string | null): string {
  return (phone ?? "").replace(/\D/g, "");
}

function defaultChoice(key: MergeFieldKey, primary: string | null, duplicate: string | null): MergeFieldChoice {
  if (!duplicate) return "primary";
  if (!primary) return "duplicate";
  if (key === "name" && duplicate.length > primary.length) return "duplicate";
  if (key === "notes") return "primary";
  return "primary";
}

function pickValue(lead: PartnerLead, key: MergeFieldKey): string | null {
  return asText(lead[key]);
}

export function buildMergePreview(primary: PartnerLead, duplicate: PartnerLead): {
  fields: MergeFieldPreview[];
  conflicts: MergeFieldPreview[];
  blocking: string[];
} {
  const fields = MERGE_FIELDS.map((key) => {
    const primaryValue = pickValue(primary, key);
    const duplicateValue = pickValue(duplicate, key);
    const same =
      key === "phone"
        ? digits(primaryValue) === digits(duplicateValue) && Boolean(primaryValue)
        : (primaryValue ?? "") === (duplicateValue ?? "");
    const bothPresent = Boolean(primaryValue) && Boolean(duplicateValue);
    const conflict = bothPresent && !same;
    return {
      key,
      label: FIELD_LABELS[key],
      primaryValue,
      duplicateValue,
      shared: same && Boolean(primaryValue),
      conflict,
      suggested: defaultChoice(key, primaryValue, duplicateValue),
      critical: CRITICAL_FIELDS.includes(key) && conflict,
    };
  });

  const blocking: string[] = [];
  if (primary.userId && duplicate.userId && primary.userId !== duplicate.userId) {
    blocking.push("Both leads are linked to different applicants. Resolve ownership before merge.");
  }
  if (primary.providerId && duplicate.providerId && primary.providerId !== duplicate.providerId) {
    blocking.push("Both leads have separate applications. Merge cannot combine two Provider records.");
  }

  return {
    fields,
    conflicts: fields.filter((f) => f.conflict),
    blocking,
  };
}

function applyField(
  primary: PartnerLead,
  duplicate: PartnerLead,
  key: MergeFieldKey,
  choice: MergeFieldChoice,
): string | null | PartnerLeadSource {
  const winner = choice === "duplicate" ? duplicate : primary;
  if (key === "notes") {
    const a = asText(primary.notes);
    const b = asText(duplicate.notes);
    if (a && b && a !== b) return `${a}\n\n— merged from duplicate —\n${b}`.slice(0, 2000);
    return a ?? b;
  }
  return pickValue(winner, key);
}

export async function previewLeadMerge(primaryLeadId: string, duplicateLeadId: string) {
  if (primaryLeadId === duplicateLeadId) {
    throw new Error("VALIDATION:Primary and duplicate must be different leads");
  }
  const [primary, duplicate] = await Promise.all([
    prisma.partnerLead.findUnique({ where: { id: primaryLeadId } }),
    prisma.partnerLead.findUnique({ where: { id: duplicateLeadId } }),
  ]);
  if (!primary || !duplicate) throw new Error("NOT_FOUND:Lead not found");
  if (duplicate.mergedIntoLeadId && duplicate.mergedIntoLeadId !== primary.id) {
    throw new Error("CONFLICT:Duplicate lead was already merged into another record");
  }
  return {
    primary: serializeLead(primary),
    duplicate: serializeLead(duplicate),
    ...buildMergePreview(primary, duplicate),
    alreadyMerged: duplicate.mergedIntoLeadId === primary.id,
  };
}

export async function markLeadDuplicate(
  leadId: string,
  duplicateOfLeadId: string,
  actorId: string,
  reason: string,
) {
  const safeReason = sanitizeUserInput(reason, 500);
  if (!safeReason.trim()) throw new Error("VALIDATION:A reason is required when marking a duplicate");
  if (leadId === duplicateOfLeadId) {
    throw new Error("VALIDATION:A lead cannot be marked as a duplicate of itself");
  }

  const [lead, canonical] = await Promise.all([
    prisma.partnerLead.findUnique({ where: { id: leadId } }),
    prisma.partnerLead.findUnique({ where: { id: duplicateOfLeadId } }),
  ]);
  if (!lead || !canonical) throw new Error("NOT_FOUND:Lead not found");
  if (lead.mergedIntoLeadId === canonical.id && lead.status === "DUPLICATE") {
    return lead;
  }
  if (lead.providerId || lead.userId) {
    throw new Error("CONFLICT:This lead already has an application. Use merge instead of mark duplicate.");
  }
  if (["REJECTED", "ACTIVATED", "WITHDRAWN"].includes(lead.status)) {
    throw new Error(`INVALID_TRANSITION:Cannot mark ${lead.status} as duplicate`);
  }

  const updated = await prisma.$transaction(async (tx) => {
    const row = await tx.partnerLead.update({
      where: { id: leadId },
      data: {
        status: "DUPLICATE",
        duplicateOfLeadId,
        lastActivityAt: new Date(),
      },
    });
    await tx.partnerLeadStatusHistory.create({
      data: {
        leadId,
        fromStatus: lead.status,
        toStatus: "DUPLICATE",
        actorId,
        actorType: "admin",
        reason: safeReason,
        metadata: { duplicateOfLeadId, action: "mark_duplicate" },
      },
    });
    await tx.partnerLeadActivity.create({
      data: {
        leadId,
        type: "DUPLICATE_CHECK",
        title: "Marked as duplicate",
        description: safeReason,
        actorId,
        actorType: "admin",
        metadata: { duplicateOfLeadId },
      },
    });
    await tx.partnerLeadActivity.create({
      data: {
        leadId: duplicateOfLeadId,
        type: "DUPLICATE_CHECK",
        title: "Linked duplicate lead",
        description: `${lead.name} marked as duplicate of this record`,
        actorId,
        actorType: "admin",
        metadata: { duplicateLeadId: leadId },
      },
    });
    return row;
  });

  await partnerAcquisitionEvents.emitLeadStatusChanged(leadId, lead.status, "DUPLICATE", actorId);
  return updated;
}

export async function mergeLeads(
  primaryLeadId: string,
  duplicateLeadId: string,
  actorId: string,
  input: { reason: string; resolutions?: MergeResolutions },
) {
  const reason = sanitizeUserInput(input.reason, 500);
  if (!reason.trim()) throw new Error("VALIDATION:A merge reason is required");
  if (primaryLeadId === duplicateLeadId) {
    throw new Error("VALIDATION:Primary and duplicate must be different leads");
  }

  const result = await prisma.$transaction(async (tx) => {
    const primary = await tx.partnerLead.findUnique({ where: { id: primaryLeadId } });
    const duplicate = await tx.partnerLead.findUnique({ where: { id: duplicateLeadId } });
    if (!primary || !duplicate) throw new Error("NOT_FOUND:Lead not found");

    if (duplicate.mergedIntoLeadId === primary.id) {
      return { primary, duplicate, idempotent: true as const };
    }
    if (duplicate.mergedIntoLeadId) {
      throw new Error("CONFLICT:Duplicate lead was already merged into another record");
    }
    if (primary.mergedIntoLeadId) {
      throw new Error("CONFLICT:Primary lead was itself merged into another record");
    }

    const preview = buildMergePreview(primary, duplicate);
    if (preview.blocking.length) {
      throw new Error(`CONFLICT:${preview.blocking[0]}`);
    }

    const unresolvedCritical = preview.fields.filter((f) => {
      if (!f.critical) return false;
      return !input.resolutions?.[f.key];
    });
    if (unresolvedCritical.length) {
      throw new Error(
        `CONFLICT:Admin review required for conflicting ${unresolvedCritical.map((f) => f.label).join(", ")}`,
      );
    }

    const data: Prisma.PartnerLeadUncheckedUpdateInput = {};
    for (const field of preview.fields) {
      const choice = input.resolutions?.[field.key] ?? field.suggested;
      const value = applyField(primary, duplicate, field.key, choice);
      if (field.key === "source" && value) data.source = value as PartnerLeadSource;
      else if (field.key === "name" && value) data.name = sanitizeUserInput(String(value), 120);
      else if (field.key === "phone" && value) {
        data.phone = String(value);
        data.phoneHash = userPiiService.hashPhone(String(value));
      } else if (field.key === "email") {
        const email = value ? String(value).toLowerCase() : primary.email;
        data.email = email;
        data.emailHash = email ? userPiiService.hashEmail(email) : null;
      } else if (field.key === "skillInterest") data.skillInterest = value ? sanitizeUserInput(String(value), 80) : primary.skillInterest;
      else if (field.key === "city") data.city = value ? sanitizeUserInput(String(value), 80) : primary.city;
      else if (field.key === "zone") data.zone = value ? sanitizeUserInput(String(value), 80) : primary.zone;
      else if (field.key === "sourceCampaign") {
        data.sourceCampaign = value ? sanitizeUserInput(String(value), 120) : primary.sourceCampaign;
      } else if (field.key === "assignedToAdminId") {
        data.assignedToAdminId = value ? String(value) : primary.assignedToAdminId;
      } else if (field.key === "notes") {
        data.notes = value ? sanitizeUserInput(String(value), 2000) : primary.notes;
      }
    }

    const moveUserId = !primary.userId && duplicate.userId ? duplicate.userId : null;
    const moveProviderId = !primary.providerId && duplicate.providerId ? duplicate.providerId : null;

    await tx.partnerLead.update({
      where: { id: duplicateLeadId },
      data: {
        userId: null,
        providerId: null,
        status: "DUPLICATE",
        mergedIntoLeadId: primaryLeadId,
        duplicateOfLeadId: primaryLeadId,
        lastActivityAt: new Date(),
      },
    });

    const mergedPrimary = await tx.partnerLead.update({
      where: { id: primaryLeadId },
      data: {
        ...data,
        userId: moveUserId ?? primary.userId,
        providerId: moveProviderId ?? primary.providerId,
        applicationAt: primary.applicationAt ?? duplicate.applicationAt,
        firstContactAt: primary.firstContactAt ?? duplicate.firstContactAt,
        activationAt: primary.activationAt ?? duplicate.activationAt,
        nextFollowUpAt: primary.nextFollowUpAt ?? duplicate.nextFollowUpAt,
        followUpReason: primary.followUpReason ?? duplicate.followUpReason,
        lastActivityAt: new Date(),
        metadata: {
          ...((primary.metadata as Record<string, unknown> | null) ?? {}),
          lastMerge: {
            mergedLeadId: duplicateLeadId,
            actorId,
            at: new Date().toISOString(),
            reason,
            resolutions: input.resolutions ?? {},
          },
        } as Prisma.InputJsonValue,
      },
    });

    await tx.partnerRegistrationSession.updateMany({
      where: { leadId: duplicateLeadId },
      data: { leadId: primaryLeadId },
    });

    await tx.partnerLeadStatusHistory.create({
      data: {
        leadId: duplicateLeadId,
        fromStatus: duplicate.status,
        toStatus: "DUPLICATE",
        actorId,
        actorType: "admin",
        reason,
        metadata: { primaryLeadId, action: "merge" },
      },
    });

    const mergeMeta = {
      primaryLeadId,
      mergedLeadId: duplicateLeadId,
      actorId,
      reason,
      resolutions: input.resolutions ?? {},
    };

    await tx.partnerLeadActivity.create({
      data: {
        leadId: primaryLeadId,
        type: "MERGE",
        title: "Merged duplicate lead",
        description: `Merged ${duplicate.name} into this record. ${reason}`,
        actorId,
        actorType: "admin",
        metadata: mergeMeta,
      },
    });
    await tx.partnerLeadActivity.create({
      data: {
        leadId: duplicateLeadId,
        type: "MERGE",
        title: "Merged into canonical lead",
        description: reason,
        actorId,
        actorType: "admin",
        metadata: mergeMeta,
      },
    });

    return { primary: mergedPrimary, duplicate, idempotent: false as const };
  });

  if (!result.idempotent) {
    await partnerAcquisitionEvents.emitLeadMerged(primaryLeadId, duplicateLeadId, actorId);
    await partnerAcquisitionEvents.emitLeadStatusChanged(
      duplicateLeadId,
      result.duplicate.status,
      "DUPLICATE",
      actorId,
    );
  }

  return {
    primaryLeadId,
    mergedLeadId: duplicateLeadId,
    idempotent: result.idempotent,
    lead: result.primary,
  };
}

function serializeLead(lead: PartnerLead) {
  return {
    id: lead.id,
    name: lead.name,
    phone: lead.phone,
    email: lead.email,
    skillInterest: lead.skillInterest,
    city: lead.city,
    zone: lead.zone,
    source: lead.source,
    sourceCampaign: lead.sourceCampaign,
    assignedToAdminId: lead.assignedToAdminId,
    notes: lead.notes,
    status: lead.status as PartnerLeadStatus,
    providerId: lead.providerId,
    userId: lead.userId,
    mergedIntoLeadId: lead.mergedIntoLeadId,
    duplicateOfLeadId: lead.duplicateOfLeadId,
    lastActivityAt: lead.lastActivityAt?.toISOString() ?? null,
  };
}
