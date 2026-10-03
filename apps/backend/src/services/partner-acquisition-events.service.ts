import prisma from "../lib/prisma";
import { eventPlatformConfig } from "../events/core/config";
import { buildHomigoEvent, emitStandalone } from "../events/core/event-publisher";
import { EVENT_SOURCES, EVENT_TYPES } from "../events/catalog/event-types";

async function emitAcquisitionEvent(
  type: string,
  aggregateId: string,
  data: Record<string, unknown>,
  actorId?: string,
  aggregateType: "partner_lead" | "provider" = "partner_lead",
) {
  if (!eventPlatformConfig.outboxEnabled || !eventPlatformConfig.partnerEventsEnabled) return;

  const event = buildHomigoEvent({
    type,
    source: EVENT_SOURCES.PARTNER_ACQUISITION,
    data,
    homigo: {
      aggregateType,
      aggregateId,
      actorType: actorId ? "admin" : "system",
      actorId: actorId ?? aggregateId,
    },
  });

  await emitStandalone(prisma, event);
}

export const partnerAcquisitionEvents = {
  async emitLeadCreated(leadId: string, data: Record<string, unknown>) {
    await emitAcquisitionEvent(EVENT_TYPES.PARTNER_LEAD_CREATED, leadId, { leadId, ...data });
  },

  async emitDuplicateDetected(leadId: string, matchCount: number, actorId?: string) {
    await emitAcquisitionEvent(
      EVENT_TYPES.PARTNER_LEAD_DUPLICATE_DETECTED,
      leadId,
      { leadId, matchCount },
      actorId,
    );
  },

  async emitLeadMerged(primaryLeadId: string, mergedLeadId: string, actorId: string) {
    await emitAcquisitionEvent(
      EVENT_TYPES.PARTNER_LEAD_MERGED,
      primaryLeadId,
      { primaryLeadId, mergedLeadId },
      actorId,
    );
  },

  async emitLeadStatusChanged(
    leadId: string,
    fromStatus: string,
    toStatus: string,
    actorId: string,
  ) {
    await emitAcquisitionEvent(
      EVENT_TYPES.PARTNER_LEAD_STATUS_CHANGED,
      leadId,
      { leadId, fromStatus, toStatus },
      actorId,
    );
    if (toStatus === "CONTACTED") {
      await emitAcquisitionEvent(EVENT_TYPES.PARTNER_LEAD_CONTACTED, leadId, { leadId }, actorId);
    }
    if (toStatus === "INTERESTED") {
      await emitAcquisitionEvent(EVENT_TYPES.PARTNER_LEAD_INTERESTED, leadId, { leadId }, actorId);
    }
  },

  async emitApplicationStarted(providerId: string, userId: string, leadId?: string) {
    const payload = { providerId, userId, leadId: leadId ?? null };
    await emitAcquisitionEvent(
      EVENT_TYPES.PARTNER_APPLICATION_CREATED,
      providerId,
      payload,
      undefined,
      "provider",
    );
    await emitAcquisitionEvent(
      EVENT_TYPES.PARTNER_APPLICATION_STARTED,
      providerId,
      payload,
      undefined,
      "provider",
    );
  },

  async emitApplicationSubmitted(providerId: string, userId: string, leadId?: string) {
    await emitAcquisitionEvent(
      EVENT_TYPES.PARTNER_APPLICATION_SUBMITTED,
      providerId,
      { providerId, userId, leadId: leadId ?? null },
      undefined,
      "provider",
    );
  },

  async emitApplicationApproved(providerId: string, adminId: string) {
    await emitAcquisitionEvent(
      EVENT_TYPES.PARTNER_APPLICATION_APPROVED,
      providerId,
      { providerId },
      adminId,
      "provider",
    );
  },

  async emitApplicationRejected(providerId: string, adminId: string, reason?: string) {
    await emitAcquisitionEvent(
      EVENT_TYPES.PARTNER_APPLICATION_REJECTED,
      providerId,
      { providerId, reason: reason ?? null },
      adminId,
      "provider",
    );
  },

  async emitApplicationChangesRequested(
    providerId: string,
    adminId: string,
    targetStep: string,
    notes?: string,
  ) {
    await emitAcquisitionEvent(
      EVENT_TYPES.PARTNER_APPLICATION_CHANGES_REQUESTED,
      providerId,
      { providerId, targetStep, notes: notes ?? null },
      adminId,
      "provider",
    );
    await emitAcquisitionEvent(
      EVENT_TYPES.PARTNER_APPLICATION_UPDATED,
      providerId,
      { providerId, field: "changes_requested", newValue: targetStep },
      adminId,
      "provider",
    );
  },

  async emitKycSubmitted(providerId: string) {
    await emitAcquisitionEvent(
      EVENT_TYPES.PARTNER_KYC_SUBMITTED,
      providerId,
      { providerId },
      undefined,
      "provider",
    );
  },

  async emitKycVerified(providerId: string, adminId?: string) {
    await emitAcquisitionEvent(
      EVENT_TYPES.PARTNER_KYC_VERIFIED,
      providerId,
      { providerId },
      adminId,
      "provider",
    );
  },

  async emitKycRejected(providerId: string, reason?: string, adminId?: string) {
    await emitAcquisitionEvent(
      EVENT_TYPES.PARTNER_KYC_REJECTED,
      providerId,
      { providerId, reason: reason ?? null },
      adminId,
      "provider",
    );
  },

  async emitPartnerActivated(providerId: string, leadId?: string) {
    await emitAcquisitionEvent(
      EVENT_TYPES.PARTNER_ACTIVATED,
      providerId,
      { providerId, leadId: leadId ?? null },
      undefined,
      "provider",
    );
    await emitAcquisitionEvent(
      EVENT_TYPES.PARTNER_CREATED,
      providerId,
      { providerId, leadId: leadId ?? null },
      undefined,
      "provider",
    );
  },

  async emitAssessmentCompleted(providerId: string, skillSlug: string, passed: boolean) {
    await emitAcquisitionEvent(
      EVENT_TYPES.PARTNER_ASSESSMENT_COMPLETED,
      providerId,
      { providerId, skillSlug, passed },
      undefined,
      "provider",
    );
  },

  async emitTrainingCompleted(providerId: string) {
    await emitAcquisitionEvent(
      EVENT_TYPES.PARTNER_TRAINING_COMPLETED,
      providerId,
      { providerId },
      undefined,
      "provider",
    );
  },
};
