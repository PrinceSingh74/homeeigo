/**
 * Pure parsing / classification for `/ws/notifications` frames (no RN imports — unit-tested).
 *
 * Frame shapes the backend sends to a partner's `user:<id>` room (apps/backend/src):
 *  - `{ type: "booking.status", data: { eventId, type:"booking.status", bookingId, status, … } }`
 *      lib/booking-realtime.ts — the authoritative transition frame, emitted on EVERY transition.
 *  - `{ type: "booking_dispatched", data: { eventId, bookingId, status:"PENDING", … } }`
 *      services/assignment-engine.service.ts — a new offer was dispatched to this partner.
 *  - `{ type: "notification.created", data: { eventId, id, notificationType, referenceId, … } }`
 *      services/notification.service.ts — e.g. notificationType BOOKING_REQUEST, WALLET_CREDIT.
 *  - `{ type: "EARNINGS_UPDATE" | "WITHDRAWAL_INITIATED" | "PAYMENT_RECEIVED", data: {…} }`
 *      services/earnings-live.service.ts — no eventId.
 *  - `{ type: "PING" | "PONG" | "SUBSCRIBE", … }` — system frames, ignored.
 *
 * Mirrors apps/partner-web/src/components/realtime/PartnerRealtimeBridge.tsx.
 */

export type RealtimeTarget =
  | "bookings"
  | "execution"
  | "dashboard"
  | "operations"
  | "wallet"
  | "notifications"
  | "reviews"
  | "support";

export type RealtimeFrame = {
  /** Stable id for de-duplication; null when the frame carries none (then it is not de-duplicated). */
  dedupeKey: string | null;
  /** Lowercased event kind (notificationType when present, else the envelope type). */
  kind: string;
  bookingId: string | null;
  targets: Set<RealtimeTarget>;
};

const SYSTEM_TYPES = new Set(["PING", "PONG", "SUBSCRIBE", "UNSUBSCRIBE"]);
const WALLET_ENVELOPES = new Set(["EARNINGS_UPDATE", "PAYMENT_RECEIVED", "WITHDRAWAL_INITIATED"]);
const BOOKING_ENVELOPES = new Set([
  "BOOKING_NEW",
  "BOOKING_ACCEPTED",
  "BOOKING_REJECTED",
  "BOOKING_CANCELLED",
  "BOOKING_COMPLETED",
  "BOOKING_STATUS",
]);

function str(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Returns null for system frames and anything that is not JSON. */
export function parseRealtimeFrame(raw: unknown): RealtimeFrame | null {
  if (typeof raw !== "string" || raw.length === 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const outer = parsed as { type?: unknown; data?: unknown };
  const envelopeType = String(outer.type ?? "").toUpperCase();
  if (SYSTEM_TYPES.has(envelopeType)) return null;

  const msg = (outer.data && typeof outer.data === "object" ? outer.data : outer) as Record<string, unknown>;
  if (msg.message === "Connected to notifications" && !("id" in msg) && !("notificationType" in msg)) return null;

  const kind = (str(msg.notificationType) ?? str(msg.type) ?? str(outer.type) ?? "").toLowerCase();
  const bookingId =
    str(msg.bookingId) ??
    (str(msg.referenceType) === "booking" ? str(msg.referenceId) : null) ??
    (kind.startsWith("booking") ? str(msg.referenceId) ?? str(msg.entityId) : null);

  const targets = new Set<RealtimeTarget>();

  const isBooking =
    kind === "booking.status" ||
    kind.startsWith("booking_") ||
    kind.startsWith("booking.") ||
    kind === "service_started" ||
    kind.includes("dispatch") ||
    kind.includes("offer") ||
    BOOKING_ENVELOPES.has(envelopeType);
  if (isBooking) {
    targets.add("bookings");
    targets.add("dashboard");
    // Accepting / finishing a job changes the partner's availability axis (ON_JOB / AVAILABLE).
    targets.add("operations");
  }
  // X-60: requirement / START-gate / safety hold / execution step / quality frames
  // (apps/backend/src/lib/booking-realtime.ts, BOOKING_REQUIREMENT_EVENT). The job screen's panels
  // refetch — mirrors partner web's PartnerRealtimeBridge. The frame is a signal, never the authority.
  if (kind === "booking.requirement") targets.add("execution");

  const isWallet =
    kind.startsWith("wallet_") ||
    kind.startsWith("wallet.") ||
    kind.startsWith("payout") ||
    kind.startsWith("withdrawal") ||
    kind.startsWith("earning") ||
    WALLET_ENVELOPES.has(envelopeType);
  if (isWallet) {
    targets.add("wallet");
    targets.add("dashboard");
  }

  if (envelopeType === "NOTIFICATION.CREATED" || kind === "notification" || kind.includes("notif")) {
    targets.add("notifications");
  }
  if (kind === "rating_received") {
    targets.add("reviews");
    targets.add("dashboard");
  }
  if (str(msg.referenceType) === "support_ticket") targets.add("support");

  const eventId = str(msg.eventId);
  const id = str(msg.id);
  const dedupeKey = eventId ?? (id ? `${id}:${kind}` : null);

  return { dedupeKey, kind, bookingId, targets };
}

/** Bounded "seen" set — a reconnect can replay frames; the same event must act once. */
export function createEventDeduper(max = 300) {
  const seen = new Set<string>();
  return {
    /** true = first time (process it); false = duplicate (drop it). Null keys always pass. */
    admit(key: string | null): boolean {
      if (key == null) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      if (seen.size > max) {
        const oldest = seen.values().next().value;
        if (oldest !== undefined) seen.delete(oldest);
      }
      return true;
    },
    size: () => seen.size,
    clear: () => seen.clear(),
  };
}

/** Exponential reconnect delay: 1 s, 2 s, 4 s … capped at 30 s, with ±20 % jitter (herd control). */
export function reconnectDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(30_000, 1_000 * 2 ** Math.max(0, Math.min(attempt, 15)));
  const jitter = base * 0.2 * (random() * 2 - 1);
  return Math.max(500, Math.min(30_000, Math.round(base + jitter)));
}

/** Close codes from apps/backend/src/lib/websocket.ts. */
export const WS_CLOSE_UNAUTHORIZED = 4401;
export const WS_CLOSE_FORBIDDEN = 4403;
