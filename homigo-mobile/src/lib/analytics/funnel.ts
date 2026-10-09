/**
 * Phase 15.2 — customer funnel events from the mobile app.
 *
 * The same server contract as `apps/web/src/lib/analytics/funnel.ts`: the six client-ingestible
 * names, a deterministic event id derived from (session, name, service, version, variant / option /
 * add-on, identity), provenance stamped by the server from the signed-in actor. Only the transport
 * details differ (session is per app launch; platform is the OS).
 *
 * Nothing here records a quote, checkout, booking, completion, cancellation or repeat: those are
 * backend facts the ingest endpoint refuses from any client.
 */
import { Platform } from "react-native";
import { apiRequest } from "@/services/auth/api-client";
import { isServiceId } from "@/lib/requested-service";

export type FunnelEventName =
  | "SERVICE_VIEW"
  | "SERVICE_CLICK"
  | "VARIANT_SELECTED"
  | "OPTION_SELECTED"
  | "ADDON_SELECTED"
  | "BOOKING_STARTED";

export type FunnelMetadata = Record<string, string | number | boolean | null | undefined>;

export type FunnelEventContext = {
  serviceId: string | undefined | null;
  serviceVersionId?: number | null;
  variantId?: string | null;
  optionId?: string | null;
  addonId?: string | null;
  identity?: string;
  metadata?: FunnelMetadata;
};

function uuid(): string {
  const g = globalThis as { crypto?: { randomUUID?: () => string } };
  if (typeof g.crypto?.randomUUID === "function") return g.crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

/** One session per app launch — the mobile equivalent of the web's per-tab session. */
const SESSION_ID = uuid();
/** Changes per launch, like the web's document instance; used for "once per launch" identity. */
const LAUNCH_INSTANCE = Math.random().toString(36).slice(2, 10);
const sent = new Set<string>();

export function funnelSessionId(): string {
  return SESSION_ID;
}

export function funnelLaunchInstance(): string {
  return LAUNCH_INSTANCE;
}

/** Identical to the web implementation — the two must produce the same digest for the same input. */
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
  return `m_${funnelDigest(parts.join("|"))}`;
}

function platform(): "ANDROID" | "IOS" | "WEB" {
  if (Platform.OS === "android") return "ANDROID";
  if (Platform.OS === "ios") return "IOS";
  return "WEB";
}

function cleanMetadata(meta: FunnelMetadata | undefined): Record<string, string | number | boolean | null> | undefined {
  if (!meta) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(meta)) if (v !== undefined) out[k] = v;
  return Object.keys(out).length ? out : undefined;
}

/** Record one funnel step. Fire-and-forget; never throws; drops events without a service id. */
export function trackFunnelEvent(name: FunnelEventName, ctx: FunnelEventContext): string | null {
  if (!ctx.serviceId) return null;
  const eventId = funnelEventId(name, SESSION_ID, ctx);
  if (sent.has(eventId)) return eventId;
  sent.add(eventId);

  const metadata = cleanMetadata(ctx.metadata);
  const body = {
    eventId,
    eventName: name,
    occurredAt: new Date().toISOString(),
    sessionId: SESSION_ID,
    serviceId: ctx.serviceId,
    ...(ctx.serviceVersionId ? { serviceVersionId: ctx.serviceVersionId } : {}),
    ...(ctx.variantId ? { variantId: ctx.variantId } : {}),
    ...(ctx.optionId ? { optionId: ctx.optionId } : {}),
    ...(ctx.addonId ? { addonId: ctx.addonId } : {}),
    source: "CUSTOMER_MOBILE",
    platform: platform(),
    ...(metadata ? { metadata } : {}),
  };

  void apiRequest("/api/analytics/events", { method: "POST", body, auth: true }).catch(() => {
    // Refused or unreachable: forget the id so a corrected attempt later is not short-circuited.
    sent.delete(eventId);
  });
  return eventId;
}

export type ServiceClickSurface = "rail-card" | "category-tile" | "search" | "recommendation";

/**
 * `service_click`: the customer actively chose a service from a listing or search. Only a real
 * catalogue id is sent; a search keyword ("cleaning") that the book screen later resolves by name
 * is not a service the server could attribute, so nothing is sent for it.
 */
export function trackServiceClick(serviceId: string | undefined | null, surface: ServiceClickSurface, extra?: { query?: string }): void {
  if (!serviceId || !isServiceId(serviceId)) return;
  trackFunnelEvent("SERVICE_CLICK", {
    serviceId,
    identity: `${surface}|${LAUNCH_INSTANCE}`,
    metadata: { surface, fromSearch: extra?.query ? true : undefined },
  });
}
