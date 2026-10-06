import { AssignmentAttemptStatus, type JobEvidence, type JobEvidenceStage, type Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { ACTIVE_FULFILMENT_STATUSES } from "../lib/privacy-policy.engine";
import { objectStorageService } from "./object-storage.service";

export type JobEvidenceActor = {
  userId: string;
  providerId?: string | null;
  isAdmin?: boolean;
};

export type RecordStageInput = {
  bookingId: string;
  providerId: string;
  stage: JobEvidenceStage | "ARRIVAL" | "START" | "COMPLETION";
  latitude?: number;
  longitude?: number;
  mediaUrls?: string[];
  mediaStorageKey?: string;
  mediaMimeType?: string;
  clientUploadId?: string;
  replace?: boolean;
  metadata?: Prisma.InputJsonValue;
  /** Set for a partner's own upload: refused once the job is no longer in an active status. */
  requireActiveJob?: boolean;
};

/**
 * Partner job evidence (ARRIVAL / START / COMPLETION photos).
 * Customer confirmation: OPTIONAL — Homigo does not require a separate customer
 * confirmation artifact at completion; customers rate post-job via Rating.
 * Do not fake confirmation evidence.
 */
/** Evidence metadata for a non-admin reader: without the raw upload URLs (`mediaUrls`). */
function withoutRawMedia(metadata: Prisma.JsonValue | null): Prisma.JsonValue | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return metadata;
  const { mediaUrls: _raw, ...rest } = metadata as Record<string, Prisma.JsonValue>;
  return rest;
}

class JobEvidenceService {
  async recordStage(input: RecordStageInput): Promise<JobEvidence> {
    const booking = await prisma.booking.findUnique({
      where: { id: input.bookingId },
      select: { id: true, providerId: true, status: true },
    });
    if (!booking) throw new Error("NOT_FOUND");
    if (booking.providerId !== input.providerId) throw new Error("FORBIDDEN");
    // A partner's own upload belongs to a job in hand. (The system's completion stamp is written
    // just after the job completes and does not ask for this.)
    if (input.requireActiveJob && !ACTIVE_FULFILMENT_STATUSES.has(String(booking.status))) throw new Error("BOOKING_NOT_ACTIVE");

    const stage = input.stage as JobEvidenceStage;
    const clientUploadId = input.clientUploadId?.trim() || null;

    if (clientUploadId) {
      const existing = await prisma.jobEvidence.findUnique({
        where: {
          bookingId_stage_clientUploadId: {
            bookingId: input.bookingId,
            stage,
            clientUploadId,
          },
        },
      });
      if (existing && existing.providerId === input.providerId) return existing;
      // The same upload id from an earlier partner on this job (the system ids are "arrive:<booking>"
      // and the like) is not this partner's row: it is neither handed back nor reused.
      if (existing) return this.recordStage({ ...input, clientUploadId: `${clientUploadId}:${input.providerId}` });
    }

    const mediaUrl = input.mediaUrls?.[0] ?? null;
    const metadata: Prisma.InputJsonValue | undefined =
      input.metadata ??
      (input.mediaUrls && input.mediaUrls.length > 0
        ? { mediaUrls: input.mediaUrls }
        : undefined);

    try {
      const created = await prisma.$transaction(async (tx) => {
        if (input.replace) {
          await tx.jobEvidence.updateMany({
            where: {
              bookingId: input.bookingId,
              // A partner replaces their own evidence, never an earlier partner's.
              providerId: input.providerId,
              stage,
              isCurrent: true,
            },
            data: { isCurrent: false },
          });
        }

        return await tx.jobEvidence.create({
          data: {
            bookingId: input.bookingId,
            providerId: input.providerId,
            stage,
            latitude: input.latitude ?? null,
            longitude: input.longitude ?? null,
            mediaStorageKey: input.mediaStorageKey ?? null,
            mediaMimeType: input.mediaMimeType ?? null,
            mediaUrl,
            clientUploadId,
            isCurrent: true,
            metadata,
          },
        });
      });
      void this.emitEvidenceEvent(created);
      return created;
    } catch (err) {
      // Unique races must be resolved outside the aborted transaction.
      if (clientUploadId) {
        const raced = await prisma.jobEvidence.findUnique({
          where: {
            bookingId_stage_clientUploadId: {
              bookingId: input.bookingId,
              stage,
              clientUploadId,
            },
          },
        });
        if (raced && raced.providerId === input.providerId) return raced;
      }
      throw err;
    }
  }

  private async emitEvidenceEvent(row: {
    id: string;
    bookingId: string;
    providerId: string;
    stage: string;
    createdAt: Date;
  }) {
    try {
      const { eventPlatformConfig } = await import("../events/core/config");
      if (!eventPlatformConfig.outboxEnabled || !eventPlatformConfig.bookingEventsEnabled) return;
      const { emitStandalone } = await import("../events/core/event-publisher");
      const { buildFieldEvidenceCreatedEvent } = await import("../events/catalog/booking.events");
      await emitStandalone(
        prisma,
        buildFieldEvidenceCreatedEvent({
          bookingId: row.bookingId,
          evidenceId: row.id,
          providerId: row.providerId,
          stage: row.stage,
          createdAt: row.createdAt,
        }),
      );
    } catch {
      /* best-effort */
    }
  }

  /** What the partner who uploaded a row is told about it: enough to refer to it, nothing it must not hold. */
  uploadReceipt(row: { id: string; bookingId: string; stage: unknown; capturedAt: Date; mediaMimeType: string | null; isCurrent: boolean; clientUploadId: string | null; createdAt: Date }) {
    return {
      id: row.id,
      bookingId: row.bookingId,
      stage: row.stage,
      capturedAt: row.capturedAt,
      mediaMimeType: row.mediaMimeType,
      isCurrent: row.isCurrent,
      clientUploadId: row.clientUploadId,
      createdAt: row.createdAt,
    };
  }

  async listForBooking(bookingId: string, actor: JobEvidenceActor) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, userId: true, providerId: true },
    });
    if (!booking) throw new Error("NOT_FOUND");

    const isCustomer = booking.userId === actor.userId;
    const isAssignedProvider =
      Boolean(actor.providerId) && booking.providerId === actor.providerId;
    // A partner who is only OFFERED the job may open the request, but is handed no evidence: the rows
    // are an earlier partner's photos of the customer's home and the position they were taken at.
    let isOfferedProvider = false;
    if (!isAssignedProvider && actor.providerId && booking.providerId === null) {
      const offered = await prisma.assignmentAttempt.findFirst({
        where: {
          providerId: actor.providerId,
          status: { in: [AssignmentAttemptStatus.SENT, AssignmentAttemptStatus.ACCEPTED] },
          job: { bookingId },
        },
        select: { id: true },
      });
      isOfferedProvider = Boolean(offered);
    }
    if (!actor.isAdmin && !isCustomer && !isAssignedProvider && !isOfferedProvider) {
      throw new Error("FORBIDDEN");
    }
    if (!actor.isAdmin && !isCustomer && isOfferedProvider) return [];
    // The partner holding the job reads the evidence they captured, not a previous partner's.
    const ownRowsOnly = !actor.isAdmin && !isCustomer && isAssignedProvider;

    const rows = await prisma.jobEvidence.findMany({
      where: { bookingId, ...(ownRowsOnly ? { providerId: actor.providerId! } : {}) },
      orderBy: [{ stage: "asc" }, { capturedAt: "desc" }],
    });

    return Promise.all(
      rows.map(async (row) => {
        let accessUrl: string | null = null;
        if (row.mediaStorageKey) {
          try {
            if (objectStorageService.isS3Enabled()) {
              accessUrl = await objectStorageService.createSignedDownloadUrl(
                "job-evidence",
                row.mediaStorageKey,
              );
            } else {
              accessUrl = `local://job-evidence/${row.mediaStorageKey}`;
            }
          } catch {
            accessUrl = null;
          }
        } else if (actor.isAdmin && row.mediaUrl) {
          accessUrl = row.mediaUrl;
        }

        return {
          id: row.id,
          bookingId: row.bookingId,
          providerId: row.providerId,
          stage: row.stage,
          // Where the evidence was captured is the customer's doorstep: audit data, for an admin only.
          ...(actor.isAdmin ? { latitude: row.latitude, longitude: row.longitude } : {}),
          capturedAt: row.capturedAt,
          mediaMimeType: row.mediaMimeType,
          isCurrent: row.isCurrent,
          clientUploadId: row.clientUploadId,
          mediaAccessUrl: accessUrl,
          // Never leak raw legacy URLs or storage keys to non-admins.
          mediaUrl: actor.isAdmin ? row.mediaUrl : undefined,
          mediaStorageKey: actor.isAdmin ? row.mediaStorageKey : undefined,
          // X-29: legacy rows keep the raw upload URLs in metadata.mediaUrls — admin only, like mediaUrl.
          metadata: actor.isAdmin ? row.metadata : withoutRawMedia(row.metadata),
          createdAt: row.createdAt,
        };
      }),
    );
  }
}

export const jobEvidenceService = new JobEvidenceService();
