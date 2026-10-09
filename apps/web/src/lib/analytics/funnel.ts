/**
 * Phase 15.2 — customer funnel events from the web app.
 *
 * One client for the six names the backend accepts from a browser (`CLIENT_INGESTIBLE_EVENTS` in
 * `apps/backend/src/services/analytics-events.service.ts`). Everything the server treats as a
 * business fact (quote, checkout, booking created / completed / cancelled, repeat) is NOT emitted
 * here and is refused by the endpoint if it were.
 *
 * Identity, not timing, decides what is a duplicate. Every event id is a digest of
 * (session, name, service, version, variant / option / add-on, extra identity), so a React
 * StrictMode double effect, a refresh, a back/forward return or a retried request reaches the same
 * `event_id` and the server keeps one row. Two genuinely different selections (variant A then
 * variant B, service X then service Y) have different ids and are both kept.
 *
 * Provenance is never sent: the server stamps it from the signed-in actor.
 */
import { apiRequest } from "@/services/auth/api-client";

export type FunnelEventName =
  | "SERVICE_VIEW"
  | "SERVICE_CLICK"
  | "VARIANT_SELECTED"
  | "OPTION_SELECTED"
  | "ADDON_SELECTED"
  | "BOOKING_STARTED";

export type FunnelMetadata = Record<string, string | number | boolean | null | undefined>;

export type FunnelEventContext = {
  /** Backend service id. Events without one are dropped (a coming-soon card has no backend row). */
  serviceId: string | undefined | null;
  /** The catalogue version the page actually rendered, when the response carried one. */
  serviceVersionId?: number | null;
  variantId?: string | null;
  optionId?: string | null;
  addonId?: string | null;
  /**
   * Extra identity — what, besides the ids above, makes this a distinct action. A listing click
   * carries the surface and the page instance so a second click after a reload counts again while
   * a double-click does not.
   */
  identity?: string;
  metadata?: FunnelMetadata;
};

const SESSION_KEY = "homigo_funnel_session";
const SENT_KEY = "homigo_funnel_sent";
const SENT_CAP = 300;

/** Changes on every document load; survives client-side navigation. */
const DOCUMENT_INSTANCE = Math.random().toString(36).slice(2, 10);

let memorySession: string | null = null;
const memorySent = new Set<string>();

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/** Per-tab session: a new tab is a new session, a refresh or back/forward is not. */
export function funnelSessionId(): string {
  if (memorySession) return memorySession;
  let id: string | null = null;
  try {
    id = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(SESSION_KEY) : null;
    if (!id) {
      id = uuid();
      sessionStorage?.setItem(SESSION_KEY, id);
    }
  } catch {
    id = id ?? uuid();
  }
  memorySession = id;
  return id;
}

/** Same function in homigo-mobile/src/lib/analytics/funnel.ts — keep them identical. */
export function funnelDigest(input: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193;
  let c = 5381;
  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i);
    a = Math.imul(a ^ ch, 0x01000193) >>> 0;
    b = Math.imul(b ^ ch, 0x1b873593) >>> 0;
    c = (Math.imul(c, 33) ^ ch) >>> 0;
  }
  return a.toString(16).padStart(8, "0") + b.toString(16).padStart(8, "0") + c.toString(16).padStart(8, "0");
}

export function funnelEventId(name: FunnelEventName, session: string, ctx: FunnelEventContext): string {
  const parts = [
    session,
    name,
    ctx.serviceId ?? "",
    ctx.serviceVersionId ?? "",
    ctx.variantId ?? "",
    ctx.optionId ?? "",
    ctx.addonId ?? "",
    ctx.identity ?? "",
  ];
  return `w_${funnelDigest(parts.join("|"))}`;
}

function readSent(): Set<string> {
  try {
    const raw = typeof sessionStorage !== "undefined" ? sessionStorage.getItem(SENT_KEY) : null;
    if (!raw) return memorySent;
    const list = JSON.parse(raw) as unknown;
    if (Array.isArray(list)) for (const id of list) if (typeof id === "string") memorySent.add(id);
  } catch {
    /* in-memory only */
  }
  return memorySent;
}

function persistSent(): void {
  try {
    const list = [...memorySent];
    const trimmed = list.length > SENT_CAP ? list.slice(list.length - SENT_CAP) : list;
    sessionStorage?.setItem(SENT_KEY, JSON.stringify(trimmed));
  } catch {
    /* in-memory only */
  }
}

function remember(id: string): void {
  memorySent.add(id);
  persistSent();
}

function forget(id: string): void {
  memorySent.delete(id);
  persistSent();
}

function cleanMetadata(meta: FunnelMetadata | undefined): Record<string, string | number | boolean | null> | undefined {
  if (!meta) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(meta)) {
    if (v === undefined) continue;
    out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Document instance, for callers that need "once per page load" identity (listing clicks). */
export function funnelDocumentInstance(): string {
  return DOCUMENT_INSTANCE;
}

/**
 * Record one funnel step. Fire-and-forget: never throws, never blocks the UI, never retried in a
 * way that could double-count (the id is deterministic, so a retry is harmless anyway).
 * Returns the event id, or null when the event was dropped for lack of a service id.
 */
export function trackFunnelEvent(name: FunnelEventName, ctx: FunnelEventContext): string | null {
  if (typeof window === "undefined") return null;
  if (!ctx.serviceId) return null;
  const session = funnelSessionId();
  const eventId = funnelEventId(name, session, ctx);
  if (readSent().has(eventId)) return eventId;
  remember(eventId);

  const body = {
    eventId,
    eventName: name,
    occurredAt: new Date().toISOString(),
    sessionId: session,
    serviceId: ctx.serviceId,
    ...(ctx.serviceVersionId ? { serviceVersionId: ctx.serviceVersionId } : {}),
    ...(ctx.variantId ? { variantId: ctx.variantId } : {}),
    ...(ctx.optionId ? { optionId: ctx.optionId } : {}),
    ...(ctx.addonId ? { addonId: ctx.addonId } : {}),
    source: "CUSTOMER_WEB",
    platform: "WEB",
    ...(cleanMetadata(ctx.metadata) ? { metadata: cleanMetadata(ctx.metadata) } : {}),
  };

  // `auth: true` attaches the bearer when a session exists (so the server can stamp the actor) and
  // sends nothing extra when it does not; an anonymous browse is still a valid event.
  void apiRequest("/api/analytics/events", { method: "POST", body, auth: true }).catch((err) => {
    // A refused event (the server knows better: stale version, unknown variant) is not a UI error.
    // Forget the id so a later, corrected attempt is not short-circuited on the client.
    forget(eventId);
    if (process.env.NODE_ENV === "development") {
      console.debug("[funnel] event not recorded", name, err instanceof Error ? err.message : err);
    }
  });
  return eventId;
}
