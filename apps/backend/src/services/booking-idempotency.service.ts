import crypto from "node:crypto";
import type { Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { incCounter } from "../lib/metrics";

/**
 * Phase 09 — bounded idempotency for booking create.
 *
 * A customer whose connection drops after the request reached the server has no way to know whether
 * a booking exists. Retrying could create a second one, at a second charge. With an `Idempotency-Key`
 * the retry replays the first answer instead.
 *
 * The arbiter is the unique index on (user_id, key) — the same mechanism the platform already trusts
 * for journal entries and webhook dedup. It is the only thing that holds when two retries race,
 * because both then attempt the same INSERT and exactly one wins.
 *
 * Deliberately bounded, so this cannot become an unbounded store of everything anyone ever sent:
 *   * a key lives for TTL_HOURS and an expired row is reclaimed by the next request that uses it;
 *   * `sweepExpired` removes the rest;
 *   * a key is accepted only within a length and character budget.
 *
 * Deliberately NOT done: inferring idempotency from the request body. A client that sends no key
 * gets exactly today's behaviour. Treating "same fields within N seconds" as a duplicate would
 * silently refuse a customer legitimately booking the same service twice.
 */

export const IDEMPOTENCY_TTL_HOURS = 24;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 128;
/** Printable ASCII without spaces — UUIDs, ULIDs and hashes all fit; control characters do not. */
const KEY_PATTERN = /^[\x21-\x7e]{8,128}$/;

export type IdempotencyBegin =
  /** No prior record: the caller owns this key and must finish or release it. */
  | { state: "PROCEED"; recordId: string }
  /** The same request already produced this booking. */
  | { state: "REPLAY"; bookingId: string }
  /** An identical request is still running elsewhere. */
  | { state: "IN_FLIGHT" }
  /** This key was first used for a DIFFERENT request. */
  | { state: "KEY_REUSED" }
  | { state: "INVALID_KEY"; reason: string };

type Row = {
  id: string;
  status: string;
  booking_id: string | null;
  request_hash: string;
  expired: boolean;
};

export function isValidIdempotencyKey(key: string): boolean {
  return KEY_PATTERN.test(key);
}

/**
 * Fingerprint of the request this key stands for.
 *
 * Only the fields that decide WHAT is being booked take part, in a fixed order, so the same booking
 * request fingerprints identically across retries regardless of key order or absent optional fields.
 * Arrays that are sets (add-ons) are sorted; a different selection is a different request.
 */
export function bookingRequestFingerprint(input: {
  serviceId: string;
  addressId: string;
  scheduledDate: string;
  providerId?: string | null;
  variantId?: string | null;
  quantity?: number | null;
  audience?: string | null;
  professionalPreference?: string | null;
  addonIds?: string[] | null;
  addonQuantities?: Record<string, number> | null;
  packagePrice?: number | null;
  couponCode?: string | null;
  description?: string | null;
}): string {
  const canonical = JSON.stringify([
    input.serviceId,
    input.addressId,
    new Date(input.scheduledDate).toISOString(),
    input.providerId ?? null,
    input.variantId ?? null,
    input.quantity ?? null,
    input.audience ?? null,
    input.professionalPreference ?? null,
    [...(input.addonIds ?? [])].sort(),
    Object.entries(input.addonQuantities ?? {}).sort(([a], [b]) => a.localeCompare(b)),
    input.packagePrice ?? null,
    input.couponCode ?? null,
    input.description ?? null,
  ]);
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

class BookingIdempotencyService {
  /**
   * Claim the key, or say what the previous holder of it did.
   *
   * Raw SQL on purpose: the decision is an INSERT that either wins the unique index or does not, and
   * that is exactly what `ON CONFLICT DO NOTHING ... RETURNING` expresses. A read-then-write in the
   * client would let two retries both see "no record" and both proceed.
   */
  async begin(userId: string, key: string, requestHash: string): Promise<IdempotencyBegin> {
    if (!isValidIdempotencyKey(key)) {
      incCounter("booking_idempotency_total", { outcome: "invalid_key" });
      return {
        state: "INVALID_KEY",
        reason: `Idempotency-Key must be 8-${MAX_IDEMPOTENCY_KEY_LENGTH} printable characters without spaces`,
      };
    }
    const id = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + IDEMPOTENCY_TTL_HOURS * 3_600_000);

    const inserted = await prisma.$queryRaw<Array<{ id: string }>>`
      INSERT INTO booking_idempotency_keys (id, user_id, key, request_hash, status, expires_at)
      VALUES (${id}, ${userId}, ${key}, ${requestHash}, 'IN_PROGRESS', ${expiresAt})
      ON CONFLICT (user_id, key) DO NOTHING
      RETURNING id
    `;
    if (inserted.length > 0) {
      incCounter("booking_idempotency_total", { outcome: "new" });
      return { state: "PROCEED", recordId: inserted[0]!.id };
    }

    const rows = await prisma.$queryRaw<Row[]>`
      SELECT id, status, booking_id, request_hash, (expires_at <= NOW()) AS expired
      FROM booking_idempotency_keys
      WHERE user_id = ${userId} AND key = ${key}
    `;
    const existing = rows[0];
    // Deleted between the two statements: the key is free again, so the caller may retry cleanly.
    if (!existing) {
      incCounter("booking_idempotency_total", { outcome: "vanished" });
      return { state: "IN_FLIGHT" };
    }

    if (existing.expired) {
      // Reclaim in one statement guarded by the expiry, so a concurrent reclaim cannot also win.
      const reclaimed = await prisma.$queryRaw<Array<{ id: string }>>`
        UPDATE booking_idempotency_keys
        SET request_hash = ${requestHash}, status = 'IN_PROGRESS', booking_id = NULL,
            completed_at = NULL, created_at = NOW(), expires_at = ${expiresAt}
        WHERE id = ${existing.id} AND expires_at <= NOW()
        RETURNING id
      `;
      if (reclaimed.length > 0) {
        incCounter("booking_idempotency_total", { outcome: "reclaimed" });
        return { state: "PROCEED", recordId: reclaimed[0]!.id };
      }
      incCounter("booking_idempotency_total", { outcome: "in_flight" });
      return { state: "IN_FLIGHT" };
    }

    if (existing.request_hash !== requestHash) {
      incCounter("booking_idempotency_total", { outcome: "key_reused" });
      return { state: "KEY_REUSED" };
    }
    if (existing.status === "COMPLETED") {
      if (existing.booking_id) {
        incCounter("booking_idempotency_total", { outcome: "replayed" });
        return { state: "REPLAY", bookingId: existing.booking_id };
      }
      // Finished, but the booking it produced is gone (ON DELETE SET NULL). There is nothing to
      // replay and the key was genuinely consumed; "in flight" would invite a retry loop.
      incCounter("booking_idempotency_total", { outcome: "consumed" });
      return { state: "KEY_REUSED" };
    }
    incCounter("booking_idempotency_total", { outcome: "in_flight" });
    return { state: "IN_FLIGHT" };
  }

  /**
   * Bind the key to the booking it produced.
   *
   * Takes the transaction when one is available, so the record and the booking commit together: a
   * key marked COMPLETED against a booking that rolled back would replay a booking that does not
   * exist.
   */
  async complete(recordId: string, bookingId: string, tx?: Prisma.TransactionClient): Promise<void> {
    const db = tx ?? prisma;
    await db.$executeRaw`
      UPDATE booking_idempotency_keys
      SET status = 'COMPLETED', booking_id = ${bookingId}, completed_at = NOW()
      WHERE id = ${recordId}
    `;
  }

  /**
   * The request failed and produced no booking, so the key must not stay locked until it expires —
   * the customer's next attempt is a legitimate first attempt.
   */
  async release(recordId: string): Promise<void> {
    await prisma.$executeRaw`DELETE FROM booking_idempotency_keys WHERE id = ${recordId} AND status = 'IN_PROGRESS'`;
  }

  /** Removes expired records. Returns how many, so the caller can log a real number. */
  async sweepExpired(limit = 1000): Promise<number> {
    const deleted = await prisma.$executeRaw`
      DELETE FROM booking_idempotency_keys
      WHERE id IN (SELECT id FROM booking_idempotency_keys WHERE expires_at <= NOW() LIMIT ${limit})
    `;
    if (deleted > 0) incCounter("booking_idempotency_swept_total", {}, deleted);
    return deleted;
  }
}

export const bookingIdempotencyService = new BookingIdempotencyService();
