import { AssignmentAttemptStatus, type JobEvidenceStage, type Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
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
};

/**
 * Partner job evidence (ARRIVAL / START / COMPLETION photos).
 * Customer confirmation: OPTIONAL — Homigo does not require a separate customer
 * confirmation artifact at completion; customers rate post-job via Rating.
 * Do not fake confirmation evidence.
 */
class JobEvidenceService {
  async recordStage(input: RecordStageInput) {
    const booking = await prisma.booking.findUnique({
      where: { id: input.bookingId },
      select: { id: true, providerId: true },
    });
    if (!booking) throw new Error("NOT_FOUND");
    if (booking.providerId !== input.providerId) throw new Error("FORBIDDEN");

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
      if (existing) return existing;
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
        if (raced) return raced;
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

  async listForBooking(bookingId: string, actor: JobEvidenceActor) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, userId: true, providerId: true },
    });
    if (!booking) throw new Error("NOT_FOUND");

    const isCustomer = booking.userId === actor.userId;
    let isAssignedProvider =
      Boolean(actor.providerId) && booking.providerId === actor.providerId;
    if (!isAssignedProvider && actor.providerId) {
      const offered = await prisma.assignmentAttempt.findFirst({
        where: {
          providerId: actor.providerId,
          status: { in: [AssignmentAttemptStatus.SENT, AssignmentAttemptStatus.ACCEPTED] },
          job: { bookingId },
        },
        select: { id: true },
      });
      isAssignedProvider = Boolean(offered);
    }
    if (!actor.isAdmin && !isCustomer && !isAssignedProvider) {
      throw new Error("FORBIDDEN");
    }

    const rows = await prisma.jobEvidence.findMany({
      where: { bookingId },
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
          latitude: row.latitude,
          longitude: row.longitude,
          capturedAt: row.capturedAt,
          mediaMimeType: row.mediaMimeType,
          isCurrent: row.isCurrent,
          clientUploadId: row.clientUploadId,
          mediaAccessUrl: accessUrl,
          // Never leak raw legacy URLs or storage keys to non-admins.
          mediaUrl: actor.isAdmin ? row.mediaUrl : undefined,
          mediaStorageKey: actor.isAdmin ? row.mediaStorageKey : undefined,
          metadata: row.metadata,
          createdAt: row.createdAt,
        };
      }),
    );
  }
}

export const jobEvidenceService = new JobEvidenceService();
