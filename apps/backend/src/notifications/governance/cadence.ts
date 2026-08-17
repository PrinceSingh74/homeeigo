import crypto from "crypto";
import { Prisma } from "@prisma/client";
import prisma from "../../lib/prisma";
import { logger } from "../../lib/logger";
import { governanceConfig, cooldownMsFor } from "./policy";
import { resolveRecipientTimeZone, windowDateFor, CADENCE_DEFAULT_TIMEZONE } from "./timezone";
import type { NotificationCategory } from "@prisma/client";
import type { RecipientType } from "../types";

/**
 * The recipient's daily allowance, and the one place it is spent.
 *
 * PostgreSQL is the authority. Redis is fast but it is a cache with an eviction policy, and a
 * counter that can quietly disappear is not something a "you may contact this person again" answer
 * should rest on — the failure is silent and the symptom is a person being messaged twice as often
 * as policy allows. Redis may accelerate a read later; it never decides.
 *
 * Two rows carry the state, and they answer different questions:
 *
 *   - the *window* holds the count, and is what makes the limit atomic. `used` only ever moves
 *     through a statement that refuses to pass `cap`;
 *   - the *reservation* holds the identity, and is what makes the limit provable. "Five went out"
 *     is five durable rows naming which operations they were, not a number someone has to trust.
 *
 * The reservation row is inserted first and the counter is moved second, both inside one
 * transaction. If the counter refuses, the transaction rolls back and the reservation row goes
 * with it, so a refused request leaves nothing behind and consumes nothing.
 */

export type ReservationInput = {
  recipientType: RecipientType;
  recipientId: string;
  /** The 6E' operation identity. Replaying it must never take a second slot. */
  idempotencyKey: string;
  notificationType: string;
  category: NotificationCategory;
  workflowId?: string;
  workflowVersion?: number;
  /** Overrides the configured cap. Present so tests can state the number they are asserting. */
  cap?: number;
  /** The moment the request is judged against. Defaults to now. */
  at?: Date;
  /**
   * Run inside the same transaction that grants the slot, if one is granted.
   *
   * Exists so the ALLOWED decision audit commits with the reservation rather than after it. A
   * granted slot with no record of why is precisely the state a decision log is meant to rule out,
   * and it would be invisible until someone asked why the numbers disagreed. The domain does not
   * need to know what the caller writes — only that it belongs to the same commit.
   */
  onReserved?: (tx: Prisma.TransactionClient) => Promise<void>;
};

export type ReservationResult =
  | { reserved: true; reservationId: string; slotNo: number; used: number; cap: number; windowDate: string; timezone: string; replayed: boolean }
  | { reserved: false; reason: "RECIPIENT_DAILY_CAP"; used: number; cap: number; windowDate: string; timezone: string }
  | { reserved: false; reason: "GOVERNANCE_UNAVAILABLE"; used: 0; cap: number; windowDate: string; timezone: string };

/** Stable, human-readable slot identity: which slot of which window this operation took. */
function reservationIdFor(input: { recipientType: string; recipientId: string; windowDate: string; slotNo: number }): string {
  return `${input.recipientType}:${input.recipientId}:${input.windowDate}#${input.slotNo}`;
}

type WindowContext = { at: Date; cap: number; timezone: string; windowDate: string };

/**
 * Move the counter, and record which slot was taken — the transactional core both entry points
 * share, so there is exactly one implementation of "spend a unit of someone's day".
 *
 * `ON CONFLICT ... WHERE used < cap` is the whole guarantee: on an existing window the update is
 * refused at the row lock rather than after a read, so two workers cannot both observe four-of-five
 * and both write five. Zero rows back means the day is full.
 *
 * `cap` is refreshed from the incoming policy, so a configuration change takes effect on the next
 * reservation rather than being frozen at whatever the window was first created with.
 */
async function moveCounterAndRecord(
  tx: Prisma.TransactionClient,
  input: ReservationInput,
  ctx: WindowContext,
): Promise<{ full: true } | { full: false; slotNo: number; used: number; cap: number }> {
  const moved = await tx.$queryRaw<Array<{ used: number; cap: number }>>`
    INSERT INTO notification_cadence_windows AS w
      (id, recipient_type, recipient_id, window_date, timezone, used, cap, created_at, updated_at)
    VALUES
      (${crypto.randomUUID()}, ${input.recipientType}, ${input.recipientId}, ${ctx.windowDate},
       ${ctx.timezone}, 1, ${ctx.cap}, NOW(), NOW())
    ON CONFLICT (recipient_type, recipient_id, window_date)
    DO UPDATE SET used = w.used + 1, cap = EXCLUDED.cap, timezone = EXCLUDED.timezone, updated_at = NOW()
    WHERE w.used < EXCLUDED.cap
    RETURNING w.used, w.cap
  `;

  if (moved.length === 0) return { full: true };

  const slotNo = moved[0].used;

  await tx.notificationCadenceReservation.create({
    data: {
      idempotencyKey: input.idempotencyKey,
      recipientType: input.recipientType,
      recipientId: input.recipientId,
      windowDate: ctx.windowDate,
      slotNo,
      workflowId: input.workflowId ?? null,
      workflowVersion: input.workflowVersion ?? null,
      notificationType: input.notificationType,
      category: input.category,
    },
  });

  if (input.onReserved) await input.onReserved(tx);

  return { full: false, slotNo, used: moved[0].used, cap: moved[0].cap };
}

/** Where the recipient's day currently is, without touching the counter. */
export async function currentWindow(
  recipientType: RecipientType,
  recipientId: string,
  at: Date = new Date(),
): Promise<{ windowDate: string; timezone: string; used: number; cap: number }> {
  const { timezone } = await resolveRecipientTimeZone(recipientType, recipientId);
  const windowDate = windowDateFor(at, timezone);
  const row = await prisma.notificationCadenceWindow.findUnique({
    where: { recipientType_recipientId_windowDate: { recipientType, recipientId, windowDate } },
    select: { used: true, cap: true },
  });
  return {
    windowDate,
    timezone,
    used: row?.used ?? 0,
    cap: row?.cap ?? governanceConfig.recipientDailyCap,
  };
}

/**
 * Take one slot of the recipient's day, or refuse.
 *
 * Called only once a notification is otherwise certain to go out — a request refused by quiet
 * hours, cooldown or preference never reaches here, so nothing that was not sent has spent
 * anything.
 */
export async function reserveDailySlot(input: ReservationInput): Promise<ReservationResult> {
  const at = input.at ?? new Date();
  const cap = input.cap ?? governanceConfig.recipientDailyCap;

  const { timezone } = await resolveRecipientTimeZone(input.recipientType, input.recipientId);
  const windowDate = windowDateFor(at, timezone);

  // A cap of zero means "never", and must not reach the insert path below — a fresh window is
  // created with used = 1, which would hand out a slot the policy does not allow.
  if (cap < 1) {
    return { reserved: false, reason: "RECIPIENT_DAILY_CAP", used: 0, cap, windowDate, timezone };
  }

  // An operation that already holds a slot keeps it. This is the durable half of replay safety:
  // the 6E' router returns early on a replay, and this makes a second reservation impossible even
  // if some future caller reaches the cadence domain directly.
  const held = await prisma.notificationCadenceReservation.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { slotNo: true, windowDate: true, recipientType: true, recipientId: true },
  });
  if (held) {
    const current = await prisma.notificationCadenceWindow.findUnique({
      where: {
        recipientType_recipientId_windowDate: {
          recipientType: held.recipientType,
          recipientId: held.recipientId,
          windowDate: held.windowDate,
        },
      },
      select: { used: true, cap: true },
    });
    return {
      reserved: true,
      reservationId: reservationIdFor(held),
      slotNo: held.slotNo,
      used: current?.used ?? held.slotNo,
      cap: current?.cap ?? cap,
      windowDate: held.windowDate,
      timezone,
      replayed: true,
    };
  }

  try {
    const outcome = await prisma.$transaction((tx) => moveCounterAndRecord(tx, input, { at, cap, timezone, windowDate }));

    if (outcome.full) {
      const current = await prisma.notificationCadenceWindow.findUnique({
        where: { recipientType_recipientId_windowDate: { recipientType: input.recipientType, recipientId: input.recipientId, windowDate } },
        select: { used: true, cap: true },
      });
      return {
        reserved: false, reason: "RECIPIENT_DAILY_CAP",
        used: current?.used ?? cap, cap: current?.cap ?? cap, windowDate, timezone,
      };
    }

    return {
      reserved: true,
      reservationId: reservationIdFor({ ...input, windowDate, slotNo: outcome.slotNo }),
      slotNo: outcome.slotNo,
      used: outcome.used,
      cap: outcome.cap,
      windowDate,
      timezone,
      replayed: false,
    };
  } catch (err) {
    /**
     * Two processes racing the same idempotency key: one inserted the reservation, the other's
     * transaction rolled back and released its counter increment with it. The loser reads the
     * winner's slot rather than reporting a failure — the operation is reserved, just not by us.
     */
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const winner = await prisma.notificationCadenceReservation.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { slotNo: true, windowDate: true, recipientType: true, recipientId: true },
      });
      if (winner) {
        const current = await prisma.notificationCadenceWindow.findUnique({
          where: {
            recipientType_recipientId_windowDate: {
              recipientType: winner.recipientType, recipientId: winner.recipientId, windowDate: winner.windowDate,
            },
          },
          select: { used: true, cap: true },
        });
        return {
          reserved: true,
          reservationId: reservationIdFor(winner),
          slotNo: winner.slotNo,
          used: current?.used ?? winner.slotNo,
          cap: current?.cap ?? cap,
          windowDate: winner.windowDate,
          timezone,
          replayed: true,
        };
      }
    }

    /**
     * Cadence state could not be established. Reporting this as "unavailable" rather than as a
     * refusal keeps the distinction the caller needs: a refusal is a decision about this
     * recipient, this is the absence of one. The caller decides what an unknown allowance means
     * for the category in hand — and for OPTIONAL traffic the answer is never "send anyway".
     */
    logger.error("cadence_reservation_failed", {
      notificationType: input.notificationType,
      recipientType: input.recipientType,
      error: err instanceof Error ? err.message.slice(0, 200) : "unknown",
    });
    return { reserved: false, reason: "GOVERNANCE_UNAVAILABLE", used: 0, cap, windowDate, timezone };
  }
}

export type GovernedReservationInput = ReservationInput & {
  workflowId: string;
  /** Overrides the configured gap. Present so a test can state the number it is asserting. */
  cooldownMs?: number;
};

export type GovernedReservationResult =
  | ReservationResult
  | { reserved: false; reason: "WORKFLOW_COOLDOWN"; lastSentAt: Date; nextEligibleAt: Date; remainingMs: number };

/**
 * Take a slot only if the workflow's own gap has also elapsed.
 *
 * The two controls have to be settled together, and this is why: cooldown is answered by reading
 * history, and a read followed by a write is not a decision — it is two decisions with a gap in
 * the middle. Two workers acting on the same person at the same moment both read "nothing sent
 * yet", both find the read encouraging, and both send. The daily cap would still hold, so the
 * table would look entirely reasonable afterwards; the person would simply have had the same
 * message twice. That is the shape of defect Phase 6E' was caught by, and the same discipline
 * applies here.
 *
 * The advisory lock is taken on the cooldown identity itself, so contention is limited to genuinely
 * competing attempts — one workflow, one recipient. Everything else proceeds in parallel, and the
 * lock is released by the commit rather than by any code path remembering to release it.
 */
export async function reserveGovernedSlot(input: GovernedReservationInput): Promise<GovernedReservationResult> {
  const at = input.at ?? new Date();
  const cooldownMs = input.cooldownMs ?? cooldownMsFor(input.workflowId);
  const lockKey = `notif_cooldown:${input.workflowId}:${input.recipientType}:${input.recipientId}`;

  // A replay already owns its slot and must not be judged against the history it created.
  const held = await prisma.notificationCadenceReservation.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true },
  });
  if (held) return reserveDailySlot(input);

  const verdict = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    // Re-read inside the lock. Whatever was true before it was taken is no longer evidence.
    const last = await tx.notificationCadenceReservation.findFirst({
      where: {
        workflowId: input.workflowId,
        recipientType: input.recipientType,
        recipientId: input.recipientId,
        idempotencyKey: { not: input.idempotencyKey },
      },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    });

    if (last) {
      const elapsedMs = at.getTime() - last.createdAt.getTime();
      if (elapsedMs < cooldownMs) {
        return {
          blocked: true as const,
          lastSentAt: last.createdAt,
          remainingMs: cooldownMs - elapsedMs,
          nextEligibleAt: new Date(last.createdAt.getTime() + cooldownMs),
        };
      }
    }

    /**
     * Still inside the lock, so no competing attempt can slip a send in between the gap being
     * judged clear and this one being recorded. The cap statement below carries its own guarantee
     * independently — this lock is about the cooldown, not about the counter.
     */
    const cap = input.cap ?? governanceConfig.recipientDailyCap;
    if (cap < 1) return { blocked: false as const, outcome: { full: true as const }, cap };

    const { timezone } = await resolveRecipientTimeZone(input.recipientType, input.recipientId);
    const windowDate = windowDateFor(at, timezone);
    const outcome = await moveCounterAndRecord(tx, input, { at, cap, timezone, windowDate });
    return { blocked: false as const, outcome, cap, timezone, windowDate };
  });

  if (verdict.blocked) {
    return {
      reserved: false, reason: "WORKFLOW_COOLDOWN",
      lastSentAt: verdict.lastSentAt, nextEligibleAt: verdict.nextEligibleAt, remainingMs: verdict.remainingMs,
    };
  }

  const timezone = verdict.timezone ?? CADENCE_DEFAULT_TIMEZONE;
  const windowDate = verdict.windowDate ?? windowDateFor(at, timezone);

  if (verdict.outcome.full) {
    const current = await prisma.notificationCadenceWindow.findUnique({
      where: {
        recipientType_recipientId_windowDate: {
          recipientType: input.recipientType, recipientId: input.recipientId, windowDate,
        },
      },
      select: { used: true, cap: true },
    });
    return {
      reserved: false, reason: "RECIPIENT_DAILY_CAP",
      used: current?.used ?? verdict.cap, cap: current?.cap ?? verdict.cap, windowDate, timezone,
    };
  }

  return {
    reserved: true,
    reservationId: reservationIdFor({ ...input, windowDate, slotNo: verdict.outcome.slotNo }),
    slotNo: verdict.outcome.slotNo,
    used: verdict.outcome.used,
    cap: verdict.outcome.cap,
    windowDate,
    timezone,
    replayed: false,
  };
}

/**
 * Give a slot back.
 *
 * Deliberately not called when a dispatch fails after reserving. Returning the slot automatically
 * would mean a provider having a bad minute could let one recipient be retried past their daily
 * limit, and the direction to fail in is under-sending, not over-sending. This exists for
 * deliberate administrative correction, and every use is expected to be explicit about why.
 */
export async function releaseDailySlot(idempotencyKey: string): Promise<boolean> {
  const held = await prisma.notificationCadenceReservation.findUnique({
    where: { idempotencyKey },
    select: { id: true, recipientType: true, recipientId: true, windowDate: true },
  });
  if (!held) return false;

  await prisma.$transaction(async (tx) => {
    await tx.notificationCadenceReservation.delete({ where: { id: held.id } });
    await tx.$executeRaw`
      UPDATE notification_cadence_windows
      SET used = GREATEST(used - 1, 0), updated_at = NOW()
      WHERE recipient_type = ${held.recipientType}
        AND recipient_id   = ${held.recipientId}
        AND window_date    = ${held.windowDate}
    `;
  });
  return true;
}
