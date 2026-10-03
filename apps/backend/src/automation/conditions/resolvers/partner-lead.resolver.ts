import prisma from "../../../lib/prisma";
import type { ConditionResolver, ResolvedValue, SubjectRef } from "../types";

const FIELDS = ["status", "assignedToAdminId", "leadScore", "source"] as const;

export const partnerLeadResolver: ConditionResolver = {
  domain: "partnerLead",
  acceptsSubjectTypes: ["partner_lead"],
  fields: [...FIELDS],

  async resolve(subject: SubjectRef, field: string): Promise<ResolvedValue | null> {
    const lead = await prisma.partnerLead.findUnique({
      where: { id: subject.subjectId },
      select: {
        status: true,
        assignedToAdminId: true,
        leadScore: true,
        source: true,
      },
    });
    if (!lead) return null;

    return { value: lead[field as (typeof FIELDS)[number]], source: "partner_lead" };
  },
};
