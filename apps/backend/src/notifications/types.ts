import type {
  NotificationCategory,
  NotificationChannel,
  NotificationDeliveryStatus,
} from "@prisma/client";

/**
 * Phase 6E' — the normalised notification contract.
 *
 * A notification request names a recipient by id and a message by template. It never carries a
 * phone number, an email address, or a rendered message body: those are resolved inside the
 * platform from approved sources. That keeps contact details out of workflow code, out of audit
 * rows, and out of anywhere a caller could accidentally point a message at the wrong person.
 */

export type RecipientType = "CUSTOMER" | "PARTNER" | "ADMIN";

export type NotificationRequest = {
  recipientType: RecipientType;
  /** A user id (CUSTOMER/ADMIN) or a provider id (PARTNER). Never a raw contact target. */
  recipientId: string;
  /** Keys into the template registry, e.g. "booking.completed". */
  notificationType: string;
  /** Only variables the template declares. Anything else is rejected. */
  variables: Record<string, unknown>;
  /**
   * Stable operation identity. Two legitimate workflow instances must produce different keys
   * even when their messages are identical, so this is never derived from message content.
   */
  idempotencyKey: string;
  /**
   * Present when a workflow asked for this notification.
   *
   * Its presence is what makes the request subject to workflow cooldown, so it is not decoration:
   * a workflow-driven notification is governed by `reserveGovernedSlot`, which settles the
   * recipient's daily allowance and the workflow's own gap together. Absent it, the router has no
   * cooldown identity to reason about and falls back to the daily allowance alone.
   */
  workflowId?: string;
  /**
   * Recorded on the reservation, never used to decide anything.
   *
   * Cooldown is deliberately version-blind — see `cooldown.ts` — so publishing v2 can never be a
   * way around the gap v1 established. This is here so the history can say which version sent.
   */
  workflowVersion?: number;
  /** The workflow run behind this notification, so a decision can be traced back to its instance. */
  workflowInstanceId?: string;
  /** Overrides preference-based selection. Used when a caller genuinely requires one channel. */
  channelOverride?: NotificationChannel;
  language?: string;
  traceId?: string;
  correlationId?: string;
};

export type ChannelTarget =
  | { channel: "PUSH"; userId: string }
  | { channel: "EMAIL"; email: string }
  | { channel: "SMS"; phone: string };

export type ResolvedRecipient = {
  userId: string;
  language: string;
  /** Only the targets that actually exist for this recipient. */
  targets: ChannelTarget[];
};

export type RenderedMessage = {
  templateId: string;
  templateVersion: number;
  channel: NotificationChannel;
  language: string;
  title: string | null;
  body: string;
};

/** What an adapter reports back. Deliberately never claims more than the provider confirms. */
export type ChannelSendResult = {
  status: Extract<NotificationDeliveryStatus, "QUEUED" | "SENT" | "DELIVERED" | "FAILED" | "UNAVAILABLE">;
  providerRef?: string;
  reasonCode?: string;
};

export type NotificationChannelAdapter = {
  channel: NotificationChannel;
  /** Whether this recipient can be reached on this channel at all. */
  canSend: (recipient: ResolvedRecipient) => boolean;
  send: (
    recipient: ResolvedRecipient,
    message: RenderedMessage,
    ctx: { notificationType: string; traceId?: string; correlationId?: string },
  ) => Promise<ChannelSendResult>;
};

export type RouteResult = {
  notificationId: string;
  status: NotificationDeliveryStatus;
  channel?: NotificationChannel;
  reasonCode?: string;
  templateId?: string;
  templateVersion?: number;
  /** True when an existing delivery for this idempotency key was returned unchanged. */
  replayed?: boolean;
  /**
   * Set when governance held the notification back rather than refusing it.
   *
   * Its presence is what distinguishes "not yet" from "not at all", and callers must key off this
   * rather than off `status`: nothing was sent in either case, but a deferral is expected to be
   * attempted again at the stated moment while a suppression is finished.
   */
  deferredUntil?: Date;
};

export const NOTIFICATION_REASON = {
  SENT: "SENT",
  REPLAYED: "REPLAYED",
  /** Operation claimed; the provider has not been called yet. */
  CLAIMED: "CLAIMED",
  /** An identical operation is being attempted right now by someone else. */
  CLAIM_IN_FLIGHT: "CLAIM_IN_FLIGHT",
  /** A previous attempt died mid-send and its claim was taken over after the lease expired. */
  CLAIM_RECOVERED: "CLAIM_RECOVERED",
  /** Held back until the recipient's quiet hours end. Not a refusal — see `deferredUntil`. */
  QUIET_HOURS: "QUIET_HOURS",
  /**
   * ── Phase 6C governance outcomes ─────────────────────────────────────────
   * These share their spelling with `GOVERNANCE_REASON` in `governance/policy.ts` on purpose: the
   * router records one reason code, and 6C-E maps it to a decision through `decisionFor()` rather
   * than through a second vocabulary that could drift out of step with this one.
   */
  RECIPIENT_DAILY_CAP: "RECIPIENT_DAILY_CAP",
  WORKFLOW_COOLDOWN: "WORKFLOW_COOLDOWN",
  GOVERNANCE_UNAVAILABLE: "GOVERNANCE_UNAVAILABLE",
  NO_TEMPLATE: "NO_TEMPLATE",
  RECIPIENT_NOT_FOUND: "RECIPIENT_NOT_FOUND",
  NO_CHANNEL_TARGET: "NO_CHANNEL_TARGET",
  PREFERENCE_OPTED_OUT: "PREFERENCE_OPTED_OUT",
  CHANNEL_NOT_PERMITTED: "CHANNEL_NOT_PERMITTED",
  VARIABLE_VALIDATION_FAILED: "VARIABLE_VALIDATION_FAILED",
  ADAPTER_FAILED: "ADAPTER_FAILED",
  UNSAFE_CONTENT: "UNSAFE_CONTENT",
} as const;

export type NotificationReason = (typeof NOTIFICATION_REASON)[keyof typeof NOTIFICATION_REASON];

export type { NotificationCategory, NotificationChannel, NotificationDeliveryStatus };
