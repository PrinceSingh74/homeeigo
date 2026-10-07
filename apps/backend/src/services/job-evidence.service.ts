import { AssignmentAttemptStatus, type JobEvidence, type JobEvidenceStage, type Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { ACTIVE_FULFILMENT_STATUSES } from "../lib/privacy-policy.engine";
import { randomUUID } from "node:crypto";
import {
  EVIDENCE_NAMESPACE,
  EVIDENCE_REUSE_LOOKBACK_DAYS,
  EvidenceRefusedError,
  evidenceSha256,
  isServerStoredEvidence,
  MAX_EVIDENCE_PHOTOS_PER_STAGE,
  MAX_EVIDENCE_ROWS_PER_BOOKING,
  serverEvidenceKey,
  type EvidenceImage,
  type EvidenceStage,
} from "../lib/job-evidence-media";
import { logger } from "../lib/logger";
import { incCounter } from "../lib/metrics";
import { objectStorageService } from "./object-storage.service";

const EVIDENCE_MIME_BY_EXT = { ".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" } as const;

/** The path a signed-in reader fetches one evidence photo from (see `evidenceMedia`). Carries ids, never a storage key. */
export const evidenceMediaPath = (bookingId: string, evidenceId: string): string => `/api/bookings/${bookingId}/evidence/${evidenceId}/media`;

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
  /**
   * Photos received from the partner in this request. The server stores the bytes and writes the
   * key; there is no way to hand this function a link or a storage key from outside.
   */
  images?: EvidenceImage[];
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
/**
 * Evidence metadata for a non-admin reader: without the raw upload URLs (`mediaUrls`), the storage
 * keys older multi-photo rows listed (`mediaKeys`), or the content hash (`sha256`, an audit value).
 */
function withoutRawMedia(metadata: Prisma.JsonValue | null): Prisma.JsonValue | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return metadata;
  const { mediaUrls: _raw, mediaKeys: _keys, sha256: _hash, ...rest } = metadata as Record<string, Prisma.JsonValue>;
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

    // The same photo twice in one request is one photo.
    const images = [...new Map((input.images ?? []).map((i) => [i.sha256, i])).values()];
    // A partner's own upload is bounded and compared; the system's position stamps (no photo, not
    // asked to check the job is in hand) are one row per stage by their upload id and are not.
    const partnerUpload = images.length > 0 || input.requireActiveJob === true;

    /**
     * What may be written, decided from the rows already on the job. Run twice: before anything is
     * stored (so a refused upload stores nothing), and again inside the transaction under the job's
     * evidence lock (so two concurrent uploads cannot both pass).
     */
    const admit = async (db: Prisma.TransactionClient | typeof prisma): Promise<{ fresh: EvidenceImage[]; already: JobEvidence | null }> => {
      if (!partnerUpload) return { fresh: images, already: null };
      const rows = await db.jobEvidence.findMany({ where: { bookingId: input.bookingId }, orderBy: { createdAt: "asc" } });
      const fresh: EvidenceImage[] = [];
      let already: JobEvidence | null = null;
      for (const image of images) {
        const same = rows.filter((r) => r.isCurrent && evidenceSha256(r.metadata) === image.sha256);
        // Sent again for the same stage by the same partner: the row that is already there answers.
        const mine = same.find((r) => r.stage === stage && r.providerId === input.providerId);
        if (mine) {
          already ??= mine;
          continue;
        }
        // The same photo as proof of another stage (a "before" offered as the "after"), or as another partner's.
        const other = same[0];
        if (other) throw new EvidenceRefusedError({ reason: "DUPLICATE_OTHER_STAGE", stage: other.stage as EvidenceStage });
        fresh.push(image);
      }
      // Nothing new to write: every photo of this upload is already this stage's evidence.
      if (images.length > 0 && fresh.length === 0) return { fresh, already };

      const own = rows.filter((r) => r.providerId === input.providerId);
      const adding = Math.max(fresh.length, 1);
      if (own.length + adding > MAX_EVIDENCE_ROWS_PER_BOOKING) throw new EvidenceRefusedError({ reason: "BOOKING_LIMIT" });
      const standing = input.replace ? 0 : own.filter((r) => r.stage === stage && r.isCurrent && r.mediaStorageKey).length;
      if (fresh.length > 0 && standing + fresh.length > MAX_EVIDENCE_PHOTOS_PER_STAGE) throw new EvidenceRefusedError({ reason: "STAGE_LIMIT" });

      if (fresh.length > 0) {
        // The same bytes on another job of this partner: a photo of one home offered as proof of another.
        // Narrowed by the provider index and a recent window, then matched on the stored hash.
        const reused = await db.jobEvidence.findFirst({
          where: {
            providerId: input.providerId,
            bookingId: { not: input.bookingId },
            createdAt: { gte: new Date(Date.now() - EVIDENCE_REUSE_LOOKBACK_DAYS * 86_400_000) },
            OR: fresh.map((i) => ({ metadata: { path: ["sha256"], equals: i.sha256 } })),
          },
          select: { id: true, bookingId: true, stage: true },
        });
        if (reused) {
          incCounter("evidence_reused_across_bookings_total", { stage: String(stage) });
          logger.warn("evidence_reused_across_bookings", { bookingId: input.bookingId, providerId: input.providerId, stage, earlierBookingId: reused.bookingId, earlierEvidenceId: reused.id });
          throw new EvidenceRefusedError({ reason: "DUPLICATE_OTHER_BOOKING" });
        }
      }
      return { fresh, already };
    };

    const first = await admit(prisma);
    if (first.already && first.fresh.length === 0) return first.already;

    // Stored only after the checks above: who holds the job, whether it is still in hand, whether
    // this upload was already recorded, and whether it may be added at all. The key names the
    // booking, partner and stage.
    const stored: { image: EvidenceImage; storageKey: string }[] = [];
    /** An object without a row is nobody's evidence: remove what this call stored and did not bind. */
    const discard = async (keys: string[]) => {
      for (const storageKey of keys) {
        try {
          await objectStorageService.deleteObject(EVIDENCE_NAMESPACE, storageKey);
        } catch (err) {
          incCounter("evidence_orphan_object_total");
          logger.error("job_evidence.orphan_object", { bookingId: input.bookingId, providerId: input.providerId, stage, storageKey, error: (err as Error)?.message });
        }
      }
    };
    try {
      for (const image of first.fresh) {
        const storageKey = serverEvidenceKey({ bookingId: input.bookingId, providerId: input.providerId, stage: stage as EvidenceStage, id: randomUUID(), ext: image.ext });
        await objectStorageService.putObject(EVIDENCE_NAMESPACE, image.bytes, { fileName: `evidence${image.ext}`, mimeType: image.mimeType, storageKey });
        stored.push({ image, storageKey });
      }
    } catch (err) {
      await discard(stored.map((s) => s.storageKey));
      throw err;
    }

    const extra = input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata) ? (input.metadata as Record<string, Prisma.InputJsonValue>) : null;
    type Outcome = { created: JobEvidence[]; existing: JobEvidence | null };
    let outcome: Outcome;
    try {
      outcome = await prisma.$transaction(async (tx): Promise<Outcome> => {
        // One evidence writer per job at a time: the limits and the duplicate check below are read
        // and then acted on, and must not interleave with another upload for the same job.
        if (partnerUpload) {
          // The partner first, then the job, always in that order: the "same photo on another of
          // my jobs" check reads across the partner's bookings, so two uploads by one partner to
          // two jobs must not interleave either.
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"job_evidence_partner:" + input.providerId}))`;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"job_evidence:" + input.bookingId}))`;
        }
        if (clientUploadId) {
          const raced = await tx.jobEvidence.findUnique({ where: { bookingId_stage_clientUploadId: { bookingId: input.bookingId, stage, clientUploadId } } });
          if (raced && raced.providerId === input.providerId) return { created: [], existing: raced };
        }
        const admitted = await admit(tx);
        const keep = new Set(admitted.fresh.map((i) => i.sha256));
        const writing = stored.filter((s) => keep.has(s.image.sha256));
        if (admitted.already && writing.length === 0) return { created: [], existing: admitted.already };

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

        // One row per photo: every stored photo is a counted piece of evidence, bound by its own key
        // to this booking, partner and stage. (The second photo of an upload used to be stored and
        // listed in `metadata.mediaKeys` of the first row, where nothing counted or checked it.)
        const created: JobEvidence[] = [];
        const slots: ({ image: EvidenceImage; storageKey: string } | null)[] = writing.length ? writing : [null];
        for (const [index, slot] of slots.entries()) {
          const photo = slot
            ? { sha256: slot.image.sha256, bytes: slot.image.bytes.length, width: slot.image.width, height: slot.image.height, ...(slots.length > 1 ? { photo: index + 1, photos: slots.length } : {}) }
            : null;
          const metadata: Prisma.InputJsonValue | undefined = photo ? { ...(extra ?? {}), ...photo } : input.metadata;
          created.push(
            await tx.jobEvidence.create({
              data: {
                bookingId: input.bookingId,
                providerId: input.providerId,
                stage,
                latitude: input.latitude ?? null,
                longitude: input.longitude ?? null,
                mediaStorageKey: slot?.storageKey ?? null,
                mediaMimeType: slot?.image.mimeType ?? null,
                mediaUrl: null,
                // The upload id names the upload; its later photos are "<id>#2", "<id>#3", …
                clientUploadId: clientUploadId && index > 0 ? `${clientUploadId}#${index + 1}` : clientUploadId,
                isCurrent: true,
                metadata,
              },
            }),
          );
        }
        return { created, existing: null };
      });
    } catch (err) {
      // Nothing was bound: the objects stored for this call are removed, whatever the reason.
      await discard(stored.map((s) => s.storageKey));
      // Unique races must be resolved outside the aborted transaction.
      if (clientUploadId && !(err instanceof EvidenceRefusedError)) {
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

    // Stored for this call but not written (the upload turned out to be a replay, or a photo was
    // already there by the time the lock was held).
    const bound = new Set(outcome.created.map((r) => r.mediaStorageKey));
    await discard(stored.map((s) => s.storageKey).filter((k) => !bound.has(k)));
    for (const row of outcome.created) void this.emitEvidenceEvent(row);
    return outcome.created[0] ?? outcome.existing!;
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
  uploadReceipt(row: { id: string; bookingId: string; stage: unknown; capturedAt: Date; mediaMimeType: string | null; isCurrent: boolean; clientUploadId: string | null; createdAt: Date; mediaStorageKey?: string | null; metadata?: unknown }) {
    const photos = row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata) ? (row.metadata as Record<string, unknown>).photos : null;
    return {
      id: row.id,
      bookingId: row.bookingId,
      stage: row.stage,
      capturedAt: row.capturedAt,
      mediaMimeType: row.mediaMimeType,
      isCurrent: row.isCurrent,
      clientUploadId: row.clientUploadId,
      // How many photos this upload stored (each is its own evidence row; this is the first).
      photoCount: typeof photos === "number" ? photos : row.mediaStorageKey ? 1 : 0,
      createdAt: row.createdAt,
    };
  }

  /** Who may read a job's evidence, and whose rows. Throws NOT_FOUND / FORBIDDEN. */
  private async readerScope(bookingId: string, actor: JobEvidenceActor): Promise<{ none: boolean; ownRowsOnly: boolean }> {
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
    return {
      none: !actor.isAdmin && !isCustomer && isOfferedProvider,
      // The partner holding the job reads the evidence they captured, not a previous partner's.
      ownRowsOnly: !actor.isAdmin && !isCustomer && isAssignedProvider,
    };
  }

  /**
   * The bytes of one evidence photo, for a reader `listForBooking` would show that row to. Only a key
   * the server wrote for this row's booking, partner and stage is ever read.
   */
  async evidenceMedia(bookingId: string, evidenceId: string, actor: JobEvidenceActor): Promise<{ body: Buffer; mimeType: string }> {
    const scope = await this.readerScope(bookingId, actor);
    if (scope.none) throw new Error("NOT_FOUND");
    const row = await prisma.jobEvidence.findFirst({
      where: { id: evidenceId, bookingId, ...(scope.ownRowsOnly ? { providerId: actor.providerId! } : {}) },
      select: { mediaStorageKey: true, bookingId: true, providerId: true, stage: true },
    });
    const key = row?.mediaStorageKey ?? null;
    if (!row || !key || !isServerStoredEvidence(row)) throw new Error("NOT_FOUND");
    const ext = (Object.keys(EVIDENCE_MIME_BY_EXT) as (keyof typeof EVIDENCE_MIME_BY_EXT)[]).find((e) => key.endsWith(e));
    if (!ext || !(await objectStorageService.headObject(EVIDENCE_NAMESPACE, key))) throw new Error("NOT_FOUND");
    return { body: await objectStorageService.getObjectBuffer(EVIDENCE_NAMESPACE, key), mimeType: EVIDENCE_MIME_BY_EXT[ext] };
  }

  async listForBooking(bookingId: string, actor: JobEvidenceActor) {
    const { none, ownRowsOnly } = await this.readerScope(bookingId, actor);
    if (none) return [];

    const rows = await prisma.jobEvidence.findMany({
      where: { bookingId, ...(ownRowsOnly ? { providerId: actor.providerId! } : {}) },
      orderBy: [{ stage: "asc" }, { capturedAt: "desc" }],
    });

    return Promise.all(
      rows.map(async (row) => {
        let accessUrl: string | null = null;
        if (row.mediaStorageKey && isServerStoredEvidence(row)) {
          // A reader is handed somewhere to fetch the photo from, never where it is kept. With S3
          // that is a short-lived signed link; without it, the served route, which answers with the
          // reader's own token. (This used to be `local://job-evidence/<storage key>`: not a URL
          // anything could open, and the storage key in full, to the partner and the customer.)
          accessUrl = evidenceMediaPath(row.bookingId, row.id);
          // A signed storage link carries the storage key in its path, so only an admin (who is
          // shown the key anyway) is given one. Everyone else reads through the served route.
          if (actor.isAdmin && objectStorageService.isS3Enabled()) {
            try {
              accessUrl = await objectStorageService.createSignedDownloadUrl(EVIDENCE_NAMESPACE, row.mediaStorageKey);
            } catch {
              /* signing failed: the served route still answers */
            }
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
