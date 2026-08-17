import crypto from "crypto";
import prisma from "../lib/prisma";
import { logger } from "../lib/logger";
import {
  recordNotificationRouted,
  recordNotificationSkipped,
  recordNotificationFailed,
  recordGovernanceAllowed,
  recordGovernanceSuppressed,
  recordGovernanceError,
  recordDailyCapSuppressed,
  recordCooldownSuppressed,
  recordQuietHoursDeferred,
} from "../lib/notification-metrics";
import { pushAdapter } from "./channels/push.adapter";
import { emailAdapter } from "./channels/email.adapter";
import { smsAdapter } from "./channels/sms.adapter";
import { evaluatePreference, categoryDefaultChannels } from "./preferences.service";
import { quietHoursApply, cadenceApplies } from "./governance/policy";
import { evaluateQuietHours } from "./governance/quiet-hours";
import { evaluateWorkflowCooldown } from "./governance/cooldown";
import { reserveGovernedSlot, reserveDailySlot } from "./governance/cadence";
import { recordDecision, recordDecisionWithin, type DecisionAuditInput } from "./governance/decision-audit";
import { GOVERNANCE_REASON, type GovernanceReason } from "./governance/policy";
import { resolveRecipient } from "./recipient-resolver";
import { resolveTemplate, validateVariables, render } from "./templates/registry";
import {
  NOTIFICATION_REASON,
  type NotificationChannelAdapter,
  type NotificationRequest,
  type RouteResult,
} from "./types";
import type { NotificationChannel } from "@prisma/client";

/**
 * The single point through which every automated communication passes.
 *
 * Workflows do not call the push, email or SMS services directly. They describe *who* and *what*,
 * and everything else — whether the recipient allows it, which channel to use, which template
 * version applies, what actually got delivered — is decided here and recorded once.
 *
 * Having one control point is the reason Phase 6C can add cadence, quiet hours and cross-channel
 * suppression later without touching a single workflow: there is exactly one place to put them,
 * marked below.
 */

const ADAPTERS: Record<NotificationChannel, NotificationChannelAdapter> = {
  PUSH: pushAdapter,
  EMAIL: emailAdapter,
  SMS: smsAdapter,
};

/**
 * Which channels a category may fall back through, in order.
 *
 * Fallback is declared per category rather than applied universally. Cascading every message
 * push → email → SMS would turn one missed notification into three contacts, and a person who
 * ignored a promotion on their phone does not want it by text as well. Only categories that
 * genuinely need a second attempt have one.
 */
const FALLBACK_ORDER: Record<string, NotificationChannel[]> = {
  SECURITY: ["SMS", "EMAIL"],
  TRANSACTIONAL: ["PUSH", "EMAIL"],
  OPTIONAL: ["PUSH"],
};

/**
 * How long a claim may stay PENDING before another process may take it over.
 *
 * Long enough that a provider call which is merely slow is never treated as abandoned, short enough
 * that a worker killed mid-send does not strand the notification.
 */
const CLAIM_LEASE_MS = 120_000;

type Claim =
  | { taken: true; notificationId: string }
  | { taken: false; result: RouteResult };

/**
 * Claim the operation before anything is sent.
 *
 * The obvious implementation — look the key up, and insert once the work is done — reads as
 * idempotent but is not: concurrent callers all find nothing, all call the provider, and only the
 * insert at the end collides. The unique index protects the *table*, not the recipient, who by then
 * has been messaged once per process.
 *
 * Writing the row first inverts that. The index decides the single owner before any provider is
 * reachable, and everyone else is told the operation already exists.
 */
async function claimIdempotency(request: NotificationRequest): Promise<Claim> {
  const notificationId = crypto.randomUUID();
  try {
    await prisma.notificationDelivery.create({
      data: {
        notificationId,
        recipientType: request.recipientType,
        recipientId: request.recipientId,
        notificationType: request.notificationType,
        // Provisional. The template decides the category and the loop decides the channel; both are
        // corrected by finalizeDelivery before the row reaches a terminal status.
        category: "TRANSACTIONAL",
        channel: "PUSH",
        status: "PENDING",
        reasonCode: NOTIFICATION_REASON.CLAIMED,
        idempotencyKey: request.idempotencyKey,
        traceId: request.traceId,
        correlationId: request.correlationId,
      },
    });
    return { taken: true, notificationId };
  } catch (err) {
    if ((err as { code?: string }).code !== "P2002") throw err;
  }

  // Someone holds the key: either a finished operation, or one in progress.
  const existing = await prisma.notificationDelivery.findUnique({
    where: { idempotencyKey: request.idempotencyKey },
    select: {
      id: true, notificationId: true, status: true, channel: true,
      templateId: true, templateVersion: true, updatedAt: true,
    },
  });
  if (!existing) {
    // The row was removed between the collision and the read. Treat as unavailable rather than
    // guessing — the caller may retry with the same key and will then win the claim cleanly.
    return {
      taken: false,
      result: {
        notificationId, status: "UNAVAILABLE",
        reasonCode: NOTIFICATION_REASON.CLAIM_IN_FLIGHT,
      },
    };
  }

  if (existing.status === "PENDING") {
    const expired = existing.updatedAt.getTime() < Date.now() - CLAIM_LEASE_MS;
    if (expired) {
      /**
       * The previous owner never came back. Take the claim over — guarded on the exact lease that
       * was read, so of several processes noticing the same expiry only one proceeds.
       */
      const takeover = await prisma.notificationDelivery.updateMany({
        where: { id: existing.id, status: "PENDING", updatedAt: existing.updatedAt },
        data: { reasonCode: NOTIFICATION_REASON.CLAIM_RECOVERED },
      });
      if (takeover.count === 1) {
        logger.warn("notification_claim_recovered", {
          notificationType: request.notificationType,
          notificationId: existing.notificationId,
        });
        return { taken: true, notificationId: existing.notificationId };
      }
    }
    // Fresh claim, or the takeover went to someone else. Nothing is sent twice on our account.
    return {
      taken: false,
      result: {
        notificationId: existing.notificationId, status: "PENDING",
        reasonCode: NOTIFICATION_REASON.CLAIM_IN_FLIGHT, replayed: true,
      },
    };
  }

  return {
    taken: false,
    result: {
      notificationId: existing.notificationId,
      status: existing.status,
      channel: existing.channel,
      templateId: existing.templateId ?? undefined,
      templateVersion: existing.templateVersion ?? undefined,
      reasonCode: NOTIFICATION_REASON.REPLAYED,
      replayed: true,
    },
  };
}

/**
 * Hand a claim back, so an operation that was held rather than sent can be attempted again.
 *
 * Two guards, and both are load-bearing:
 *
 *   - `notificationId` is a fresh UUID minted inside `claimIdempotency` and never shared, so one
 *     worker cannot express a delete of another worker's claim even by accident. The idempotency
 *     key would not do — several workers know it, and exactly one of them owns the row;
 *   - `status: PENDING` means a claim that has already settled into a terminal status is beyond
 *     reach. A deferral arriving late cannot erase a delivery that has since happened.
 *
 * Returns whether this call was the one that released it, so a caller can tell "I let go" from
 * "someone else already had".
 */
export async function releaseClaim(notificationId: string): Promise<boolean> {
  const released = await prisma.notificationDelivery.deleteMany({
    where: { notificationId, status: "PENDING" },
  });
  return released.count === 1;
}

/** Settle the claimed row with what actually happened. */
async function finalizeDelivery(input: {
  notificationId: string;
  category: "TRANSACTIONAL" | "SECURITY" | "OPTIONAL";
  channel?: NotificationChannel;
  status: RouteResult["status"];
  reasonCode: string;
  templateId?: string;
  templateVersion?: number;
  language?: string;
  providerRef?: string;
}): Promise<string> {
  await prisma.notificationDelivery.update({
    where: { notificationId: input.notificationId },
    data: {
      category: input.category,
      channel: input.channel ?? "PUSH",
      templateId: input.templateId,
      templateVersion: input.templateVersion,
      language: input.language,
      status: input.status,
      reasonCode: input.reasonCode,
      providerRef: input.providerRef,
      sentAt: input.status === "SENT" || input.status === "QUEUED" ? new Date() : null,
    },
  });
  return input.notificationId;
}

export async function routeNotification(request: NotificationRequest): Promise<RouteResult> {
  /**
   * Idempotency first, before anything is resolved or sent.
   *
   * The key is supplied by the caller and derives from its own execution identity, never from the
   * message text — two customers can legitimately receive the same words, and two workflow
   * instances acting on the same booking are still two operations.
   */
  const claim = await claimIdempotency(request);
  if (!claim.taken) return claim.result;
  const notificationId = claim.notificationId;

  // The template decides the category, so it is resolved before any policy is applied. Language
  // preference is read from the recipient below; English is the fallback for lookup only.
  const probe = resolveTemplate({
    notificationType: request.notificationType,
    channel: request.channelOverride ?? "PUSH",
    language: request.language ?? "en",
  });
  const anyTemplate =
    probe ??
    resolveTemplate({ notificationType: request.notificationType, channel: "EMAIL", language: "en" }) ??
    resolveTemplate({ notificationType: request.notificationType, channel: "SMS", language: "en" });

  if (!anyTemplate) {
    const id = await finalizeDelivery({
      notificationId, category: "TRANSACTIONAL", status: "SKIPPED",
      reasonCode: NOTIFICATION_REASON.NO_TEMPLATE,
    });
    recordNotificationSkipped(request.notificationType, NOTIFICATION_REASON.NO_TEMPLATE);
    return { notificationId: id, status: "SKIPPED", reasonCode: NOTIFICATION_REASON.NO_TEMPLATE };
  }

  const category = anyTemplate.category;

  const resolved = await resolveRecipient(request.recipientType, request.recipientId);
  if (!resolved.ok) {
    const id = await finalizeDelivery({
      notificationId, category, status: "SKIPPED", reasonCode: NOTIFICATION_REASON.RECIPIENT_NOT_FOUND,
    });
    recordNotificationSkipped(request.notificationType, NOTIFICATION_REASON.RECIPIENT_NOT_FOUND);
    return { notificationId: id, status: "SKIPPED", reasonCode: NOTIFICATION_REASON.RECIPIENT_NOT_FOUND };
  }
  const recipient = resolved.recipient;
  const language = request.language ?? recipient.language;

  /**
   * Everything a decision record needs except the decision itself.
   *
   * Assembled once so every governance outcome below is described the same way, and deliberately
   * carrying identifiers only — no variables, no rendered text, nothing that could become a copy of
   * the message.
   */
  const auditBase = {
    recipientType: request.recipientType,
    recipientId: request.recipientId,
    notificationType: request.notificationType,
    category,
    idempotencyKey: request.idempotencyKey,
    workflowId: request.workflowId,
    workflowVersion: request.workflowVersion,
    workflowInstanceId: request.workflowInstanceId,
    traceId: request.traceId,
    correlationId: request.correlationId,
  } satisfies Omit<DecisionAuditInput, "reason">;

  /**
   * ── Phase 6C governance ────────────────────────────────────────────────────
   *
   * Quiet hours are settled here, after the recipient and category are known and before any
   * adapter can be reached. Cadence and cooldown join this block in 6C-F; only the quiet-hours
   * control is wired today.
   *
   * The check has to live inside the router rather than in front of it, because by this point the
   * operation already holds a PENDING claim. A deferral that walked away without releasing it
   * would leave the key permanently taken, and every attempt to resume would be answered with
   * "already in flight" — the notification would be held back forever by its own first attempt.
   */
  if (quietHoursApply(category)) {
    const quiet = await evaluateQuietHours(request.recipientType, request.recipientId);
    if (quiet.inQuietHours) {
      const released = await releaseClaim(notificationId);

      logger.info("notification_deferred_quiet_hours", {
        notificationType: request.notificationType,
        notificationId,
        localTime: quiet.localTime,
        timezone: quiet.timezone,
        timezoneFallback: quiet.timezoneFallback,
        nextAllowedAt: quiet.nextAllowedAt?.toISOString(),
        claimReleased: released,
      });
      recordNotificationSkipped(request.notificationType, NOTIFICATION_REASON.QUIET_HOURS);
      recordQuietHoursDeferred(request.notificationType);

      /**
       * No notificationId is recorded: the claim has just been released, so pointing at it would
       * name a row that no longer exists. The resume is a separate evaluation with its own record,
       * and `idempotencyKey` is what threads the two together.
       */
      await recordDecision({
        ...auditBase,
        reason: GOVERNANCE_REASON.QUIET_HOURS,
        deferredUntil: quiet.nextAllowedAt ?? undefined,
        reasonText: `local ${quiet.localTime} in ${quiet.timezone}`,
      });

      /**
       * No delivery row survives a deferral, so this result is a control signal rather than a
       * record of one — the durable explanation is Phase 6C-E's business. `deferredUntil` is what
       * the caller keys off; `PENDING` says only that nothing has been attempted yet, which is the
       * honest reading of a message that is still intended to go out.
       */
      return {
        notificationId,
        status: "PENDING",
        reasonCode: NOTIFICATION_REASON.QUIET_HOURS,
        deferredUntil: quiet.nextAllowedAt ?? undefined,
      };
    }
  }

  /** Whether this category is governed at all. Mandatory traffic is exempt by stated policy. */
  const governed = cadenceApplies(category);

  /**
   * Cooldown, asked early and cheaply.
   *
   * A read, and nothing more — the authority is `reserveGovernedSlot`, which re-asks the same
   * question inside a lock. This exists only to abandon a notification before templates are
   * resolved and a message is rendered for someone the workflow may not contact yet. A "yes" here
   * is not permission; the commit can still refuse, and refusing later is the safe direction.
   */
  if (governed && request.workflowId) {
    const cooldown = await evaluateWorkflowCooldown({
      workflowId: request.workflowId,
      recipientType: request.recipientType,
      recipientId: request.recipientId,
      idempotencyKey: request.idempotencyKey,
    });
    if (!cooldown.allowed) {
      const id = await finalizeDelivery({
        notificationId, category, status: "SKIPPED",
        reasonCode: NOTIFICATION_REASON.WORKFLOW_COOLDOWN, language,
      });
      recordCooldownSuppressed(request.notificationType, request.workflowId);
      recordGovernanceSuppressed(request.notificationType, NOTIFICATION_REASON.WORKFLOW_COOLDOWN);
      logger.info("notification_suppressed_cooldown", {
        notificationType: request.notificationType, workflowId: request.workflowId,
        nextEligibleAt: cooldown.nextEligibleAt.toISOString(),
      });
      await recordDecision({
        ...auditBase, notificationId: id,
        reason: GOVERNANCE_REASON.WORKFLOW_COOLDOWN,
        reasonText: `next eligible ${cooldown.nextEligibleAt.toISOString()}`,
      });
      return {
        notificationId: id, status: "SKIPPED",
        reasonCode: NOTIFICATION_REASON.WORKFLOW_COOLDOWN,
      };
    }
  }

  const candidates = request.channelOverride
    ? [request.channelOverride]
    : (FALLBACK_ORDER[category] ?? categoryDefaultChannels(category));

  let lastReason: string = NOTIFICATION_REASON.NO_CHANNEL_TARGET;

  /**
   * The recipient's allowance is spent once, for the whole operation.
   *
   * Held outside the loop deliberately. A notification that falls back from push to email is one
   * message the person receives, not two, and charging them twice would mean a recipient whose
   * device token had expired quietly used up their day twice as fast as anyone else. Equally, a
   * channel refused for lack of a target or by preference must cost nothing at all — the loop can
   * run to exhaustion without a single unit being spent, which is exactly what happens for someone
   * who has opted out of everything.
   */
  let reservationId: string | null = null;

  for (const channel of candidates) {
    const adapter = ADAPTERS[channel];

    if (!adapter.canSend(recipient)) { lastReason = NOTIFICATION_REASON.NO_CHANNEL_TARGET; continue; }

    const decision = await evaluatePreference({ userId: recipient.userId, channel, category });
    if (!decision.allowed) { lastReason = NOTIFICATION_REASON.PREFERENCE_OPTED_OUT; continue; }

    const template = resolveTemplate({ notificationType: request.notificationType, channel, language });
    if (!template) { lastReason = NOTIFICATION_REASON.NO_TEMPLATE; continue; }

    const validated = validateVariables(template, request.variables);
    if (!validated.ok) {
      // A schema violation is the caller's bug, not a channel problem — do not try another channel
      // with the same bad input.
      const id = await finalizeDelivery({
        notificationId, category, channel, status: "SKIPPED",
        reasonCode: NOTIFICATION_REASON.VARIABLE_VALIDATION_FAILED,
        templateId: template.templateId, templateVersion: template.version, language,
      });
      recordNotificationSkipped(request.notificationType, NOTIFICATION_REASON.VARIABLE_VALIDATION_FAILED);
      logger.warn("notification_variables_rejected", {
        notificationType: request.notificationType, error: validated.error,
      });
      return {
        notificationId: id, status: "SKIPPED", channel,
        reasonCode: NOTIFICATION_REASON.VARIABLE_VALIDATION_FAILED,
      };
    }

    /**
     * The commit, at the last possible moment before a person is actually contacted.
     *
     * Everything above this line can still decline for free: no target, opted out, no template for
     * this channel, variables that do not match the schema. Only once a channel is genuinely
     * sendable does the operation spend anything, which is what keeps "we refused to send" and "we
     * used up part of their day" from ever being the same event.
     *
     * A workflow-driven notification goes through `reserveGovernedSlot`, which settles the daily
     * allowance and the workflow's own gap under one lock. Calling the plain daily reservation here
     * would leave cooldown enforced only by the earlier read — and a read is what let four
     * processes each send inside the same one-hour window when 6C-C measured it.
     */
    if (governed && reservationId === null) {
      /**
       * The ALLOWED record commits with the slot it explains.
       *
       * Writing it afterwards would leave a window in which a recipient's allowance is spent and
       * nothing says why — and that gap is invisible until someone audits the numbers and finds
       * they disagree. Sharing the transaction means both land or neither does.
       */
      const onReserved = (tx: Parameters<NonNullable<Parameters<typeof reserveDailySlot>[0]["onReserved"]>>[0]) =>
        recordDecisionWithin(tx, {
          ...auditBase, notificationId, channelIntent: channel,
          reason: GOVERNANCE_REASON.ALLOWED,
        });

      const reservation = request.workflowId
        ? await reserveGovernedSlot({
            recipientType: request.recipientType, recipientId: request.recipientId,
            idempotencyKey: request.idempotencyKey, notificationType: request.notificationType,
            category, workflowId: request.workflowId, workflowVersion: request.workflowVersion,
            onReserved,
          })
        : await reserveDailySlot({
            recipientType: request.recipientType, recipientId: request.recipientId,
            idempotencyKey: request.idempotencyKey, notificationType: request.notificationType,
            category, onReserved,
          });

      if (!reservation.reserved) {
        /**
         * Suppression is final for this operation, not "try again tomorrow".
         *
         * The claim settles as SKIPPED, so a retry of the same workflow step replays that answer
         * rather than re-attempting once the gap has passed. That is the existing 6C rule and it is
         * the safe direction — a step that kept re-attempting would turn one suppressed message
         * into a queue of them waiting for the moment the cap resets.
         *
         * An undeterminable allowance lands here too. There is no bypass for it: not knowing
         * whether someone may be contacted is not a reason to contact them.
         */
        const reasonCode =
          reservation.reason === "WORKFLOW_COOLDOWN" ? NOTIFICATION_REASON.WORKFLOW_COOLDOWN
          : reservation.reason === "GOVERNANCE_UNAVAILABLE" ? NOTIFICATION_REASON.GOVERNANCE_UNAVAILABLE
          : NOTIFICATION_REASON.RECIPIENT_DAILY_CAP;

        const id = await finalizeDelivery({
          notificationId, category, channel, status: "SKIPPED", reasonCode,
          templateId: template.templateId, templateVersion: template.version, language,
        });

        recordGovernanceSuppressed(request.notificationType, reasonCode);
        if (reasonCode === NOTIFICATION_REASON.RECIPIENT_DAILY_CAP) {
          recordDailyCapSuppressed(request.notificationType);
        } else if (reasonCode === NOTIFICATION_REASON.WORKFLOW_COOLDOWN && request.workflowId) {
          recordCooldownSuppressed(request.notificationType, request.workflowId);
        } else if (reasonCode === NOTIFICATION_REASON.GOVERNANCE_UNAVAILABLE) {
          recordGovernanceError(request.notificationType, reasonCode);
          logger.error("notification_governance_unavailable", {
            notificationType: request.notificationType, workflowId: request.workflowId,
          });
        }

        await recordDecision({
          ...auditBase, notificationId: id, channelIntent: channel,
          reason:
            reasonCode === NOTIFICATION_REASON.WORKFLOW_COOLDOWN ? GOVERNANCE_REASON.WORKFLOW_COOLDOWN
            : reasonCode === NOTIFICATION_REASON.GOVERNANCE_UNAVAILABLE ? GOVERNANCE_REASON.GOVERNANCE_UNAVAILABLE
            : GOVERNANCE_REASON.RECIPIENT_DAILY_CAP,
        });

        return { notificationId: id, status: "SKIPPED", channel, reasonCode };
      }

      reservationId = reservation.reservationId;
      recordGovernanceAllowed(request.notificationType);
    }

    const { title, body } = render(template, validated.values);
    const result = await adapter.send(
      recipient,
      {
        templateId: template.templateId, templateVersion: template.version,
        channel, language, title, body,
      },
      {
        notificationType: request.notificationType,
        traceId: request.traceId,
        correlationId: request.correlationId,
      },
    );

    if (result.status === "FAILED" || result.status === "UNAVAILABLE") {
      lastReason = result.reasonCode ?? NOTIFICATION_REASON.ADAPTER_FAILED;
      continue;   // the next declared fallback, if this category has one
    }

    const id = await finalizeDelivery({
      notificationId, category, channel, status: result.status,
      reasonCode: NOTIFICATION_REASON.SENT,
      templateId: template.templateId, templateVersion: template.version,
      language, providerRef: result.providerRef,
    });
    recordNotificationRouted(request.notificationType, channel, result.status);
    return {
      notificationId: id, status: result.status, channel,
      templateId: template.templateId, templateVersion: template.version,
      reasonCode: NOTIFICATION_REASON.SENT,
    };
  }

  const id = await finalizeDelivery({
    notificationId, category, status: "UNAVAILABLE", reasonCode: lastReason, language,
  });
  recordNotificationFailed(request.notificationType, lastReason);

  /**
   * Preference is settled here, after the loop, and only here.
   *
   * A rejected channel does not end the attempt — it sets `lastReason` and the loop tries the next
   * one. Writing a decision at the point of rejection would produce a record per channel for a
   * single evaluation, which is the duplication this table exists to avoid; and the earlier
   * rejection may not even be the final answer, since a later channel can still send.
   *
   * The other ways the loop can run out — no device, no template for any channel, a variable
   * schema violation — are not governance decisions. They belong to reachability and template
   * resolution, `NotificationDelivery` already records each with its own reason, and copying them
   * here would turn a decision log into a second delivery log.
   */
  if (lastReason === NOTIFICATION_REASON.PREFERENCE_OPTED_OUT) {
    recordGovernanceSuppressed(request.notificationType, lastReason);
    await recordDecision({
      ...auditBase, notificationId: id,
      reason: GOVERNANCE_REASON.PREFERENCE_OPTED_OUT,
    });
  }

  return { notificationId: id, status: "UNAVAILABLE", reasonCode: lastReason };
}
