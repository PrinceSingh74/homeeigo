/**
 * Phase 15.1 — product-funnel analytics events.
 *
 * Measurement only. This module never writes a booking, payment, rating, or ledger row, and
 * nothing that reads those tables should treat a row here as a substitute. Authoritative
 * stages (quote, booking created/completed/cancelled, checkout) continue to live on their
 * transactional tables and on `event_outbox`; this table attributes a funnel step so 15.2–15.4
 * can count without double-counting retries.
 *
 * Provenance is stamped here, never accepted from the client: the actor's `data_origin`, or
 * the booking's when a booking is attached. Population policy remains `analyticsWhere()` in
 * `src/lib/analytics-scope.ts`.
 */
import type { AnalyticsEventName, AnalyticsEventPlatform, AnalyticsEventSource, DataOrigin, Prisma } from "@prisma/client";
import prisma from "../lib/prisma";
import { getPrismaErrorCode } from "../lib/prisma-errors";
import { AUDIENCES, PROFESSIONAL_PREFERENCES, parseCatalogConfig } from "../lib/service-catalog-config";
import { CUSTOMER_CATALOG_WHERE } from "../lib/service-domain";
import { isBusinessRow } from "../lib/analytics-scope";
import { logger } from "../lib/logger";

export const CLIENT_INGESTIBLE_EVENTS = [
  "SERVICE_VIEW",
  "SERVICE_CLICK",
  "VARIANT_SELECTED",
  "OPTION_SELECTED",
  "ADDON_SELECTED",
  "BOOKING_STARTED",
] as const satisfies readonly AnalyticsEventName[];

export const BACKEND_ONLY_EVENTS = [
  "QUOTE_GENERATED",
  "CHECKOUT_STARTED",
  "BOOKING_CREATED",
  "BOOKING_COMPLETED",
  "CANCELLED",
  "REPEAT_BOOKING",
] as const satisfies readonly AnalyticsEventName[];

const CLIENT_SET = new Set<string>(CLIENT_INGESTIBLE_EVENTS);
const BACKEND_SET = new Set<string>(BACKEND_ONLY_EVENTS);
const EVENT_NAMES = new Set<string>([...CLIENT_INGESTIBLE_EVENTS, ...BACKEND_ONLY_EVENTS]);

const SOURCES: readonly AnalyticsEventSource[] = [
  "CUSTOMER_WEB",
  "CUSTOMER_MOBILE",
  "PARTNER_WEB",
  "PARTNER_MOBILE",
  "ADMIN",
  "BACKEND",
];
const PLATFORMS: readonly AnalyticsEventPlatform[] = ["WEB", "ANDROID", "IOS", "SERVER"];

const EVENT_ID_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SESSION_RE = /^[A-Za-z0-9_-]{8,64}$/;
const SENSITIVE_META_KEY = /token|password|secret|card|cvv|pan|authorization|cookie|otp/i;
const MAX_FUTURE_MS = 5 * 60 * 1000;
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type AnalyticsEventError =
  | "MALFORMED_EVENT"
  | "UNAUTHORIZED_EVENT"
  | "SERVICE_NOT_FOUND"
  | "SERVICE_NOT_VISIBLE"
  | "SERVICE_VERSION_NOT_FOUND"
  | "VARIANT_NOT_ON_SERVICE"
  | "ADDON_NOT_ON_SERVICE"
  | "OPTION_NOT_ON_SERVICE"
  | "BOOKING_NOT_FOUND"
  | "BOOKING_SERVICE_MISMATCH"
  | "BOOKING_ACTOR_MISMATCH";

export type IngestResult =
  | { ok: true; duplicate: boolean; id: string; dataOrigin: DataOrigin | null }
  | { ok: false; error: AnalyticsEventError; detail?: string };

export type AnalyticsEventInput = {
  eventId: string;
  eventName: string;
  occurredAt?: string | Date;
  sessionId?: string;
  serviceId?: string;
  serviceVersionId?: number;
  variantId?: string;
  optionId?: string;
  addonId?: string;
  bookingId?: string;
  quoteFingerprint?: string;
  source: string;
  platform: string;
  metadata?: unknown;
};

export type ActorContext = {
  userId: string;
  dataOrigin: DataOrigin | null;
};

const EVENTS_NEEDING_SERVICE = new Set<string>([
  "SERVICE_VIEW",
  "SERVICE_CLICK",
  "VARIANT_SELECTED",
  "OPTION_SELECTED",
  "ADDON_SELECTED",
  "QUOTE_GENERATED",
  "BOOKING_STARTED",
]);

const EVENTS_NEEDING_VARIANT = new Set<string>(["VARIANT_SELECTED"]);
const EVENTS_NEEDING_ADDON = new Set<string>(["ADDON_SELECTED"]);
const EVENTS_NEEDING_OPTION = new Set<string>(["OPTION_SELECTED"]);
const EVENTS_NEEDING_BOOKING = new Set<string>([
  "CHECKOUT_STARTED",
  "BOOKING_CREATED",
  "BOOKING_COMPLETED",
  "CANCELLED",
  "REPEAT_BOOKING",
]);

function fail(error: AnalyticsEventError, detail?: string): IngestResult {
  return { ok: false, error, detail };
}

function asString(v: unknown, max: number): string | undefined {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  if (!s || s.length > max) return undefined;
  return s;
}

function sanitizeMetadata(raw: unknown): Prisma.InputJsonValue | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= 20) break;
    if (!k || k.length > 40 || SENSITIVE_META_KEY.test(k)) continue;
    if (v == null) {
      out[k] = null;
      continue;
    }
    if (typeof v === "string") {
      if (v.length <= 200 && !SENSITIVE_META_KEY.test(v)) out[k] = v;
      continue;
    }
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    if (typeof v === "boolean") out[k] = v;
  }
  return Object.keys(out).length ? out : undefined;
}

export function analyticsEnvironment(env: NodeJS.ProcessEnv = process.env): string {
  const app = (env.APP_ENV ?? "").trim().toLowerCase();
  if (app === "production" || app === "staging" || app === "test") return app;
  if (app === "dev" || app === "development" || app === "local") return "dev";
  if (env.NODE_ENV === "test") return "test";
  if (env.NODE_ENV === "production") return "production";
  return "dev";
}

function parseOccurredAt(value: string | Date | undefined): Date | null {
  if (value == null) return new Date();
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const now = Date.now();
  if (d.getTime() - now > MAX_FUTURE_MS) return null;
  if (now - d.getTime() > MAX_AGE_MS) return null;
  return d;
}

async function resolveService(serviceId: string, requireVisible: boolean) {
  return prisma.service.findFirst({
    where: requireVisible ? { id: serviceId, ...CUSTOMER_CATALOG_WHERE } : { id: serviceId },
    select: {
      id: true,
      version: true,
      catalogConfig: true,
      minPrice: true,
      maxPrice: true,
      basePrice: true,
      variants: { where: { isActive: true }, select: { code: true } },
      addons: { where: { isActive: true }, select: { code: true } },
    },
  });
}

function variantCodesOf(service: {
  variants: { code: string }[];
  catalogConfig: unknown;
}): Set<string> {
  const codes = new Set(service.variants.map((v) => v.code));
  if (codes.size) return codes;
  const cfg = parseCatalogConfig(service.catalogConfig);
  for (const v of cfg?.variants ?? []) {
    if (v.active !== false && v.id) codes.add(v.id);
  }
  return codes;
}

function addonCodesOf(service: {
  addons: { code: string }[];
  catalogConfig: unknown;
}): Set<string> {
  const codes = new Set(service.addons.map((a) => a.code));
  if (codes.size) return codes;
  const cfg = parseCatalogConfig(service.catalogConfig);
  for (const a of cfg?.addons ?? []) {
    if (a.active !== false && a.id) codes.add(a.id);
  }
  return codes;
}

function optionValidOn(
  service: { catalogConfig: unknown; minPrice: number | null; maxPrice: number | null; basePrice: number },
  optionId: string,
): boolean {
  const cfg = parseCatalogConfig(service.catalogConfig);
  const audiences = cfg?.audiences?.length ? cfg.audiences : [...AUDIENCES];
  if ((audiences as readonly string[]).includes(optionId)) return true;
  if ((PROFESSIONAL_PREFERENCES as readonly string[]).includes(optionId)) return true;
  const min = service.minPrice ?? service.basePrice;
  const max = service.maxPrice ?? Math.max(service.basePrice, min);
  const tiers = [...new Set([min, service.basePrice, max])].map((n) => String(n));
  return tiers.includes(optionId);
}

async function versionExists(serviceId: string, version: number, currentVersion: number): Promise<boolean> {
  if (version === currentVersion) return true;
  const row = await prisma.serviceConfigVersion.findFirst({
    where: { serviceId, version },
    select: { id: true },
  });
  return !!row;
}

function stampOrigin(actor: ActorContext | null, bookingOrigin: DataOrigin | null | undefined): DataOrigin | null {
  if (bookingOrigin !== undefined) return bookingOrigin ?? null;
  return actor?.dataOrigin ?? null;
}

async function persist(args: {
  input: AnalyticsEventInput;
  actor: ActorContext | null;
  requireVisibleService: boolean;
  forceSource?: AnalyticsEventSource;
}): Promise<IngestResult> {
  const { input, actor, requireVisibleService } = args;
  const eventId = asString(input.eventId, 64);
  if (!eventId || !EVENT_ID_RE.test(eventId)) return fail("MALFORMED_EVENT", "eventId");
  if (!EVENT_NAMES.has(input.eventName)) return fail("MALFORMED_EVENT", "eventName");
  const eventName = input.eventName as AnalyticsEventName;
  const source = args.forceSource ?? (SOURCES.includes(input.source as AnalyticsEventSource) ? (input.source as AnalyticsEventSource) : null);
  if (!source) return fail("MALFORMED_EVENT", "source");
  const platform = PLATFORMS.includes(input.platform as AnalyticsEventPlatform)
    ? (input.platform as AnalyticsEventPlatform)
    : null;
  if (!platform) return fail("MALFORMED_EVENT", "platform");
  const occurredAt = parseOccurredAt(input.occurredAt);
  if (!occurredAt) return fail("MALFORMED_EVENT", "occurredAt");

  const sessionId = input.sessionId ? asString(input.sessionId, 64) : undefined;
  if (input.sessionId && (!sessionId || !SESSION_RE.test(sessionId))) return fail("MALFORMED_EVENT", "sessionId");

  const serviceId = input.serviceId ? asString(input.serviceId, 64) : undefined;
  const variantId = input.variantId ? asString(input.variantId, 80) : undefined;
  const addonId = input.addonId ? asString(input.addonId, 80) : undefined;
  const optionId = input.optionId ? asString(input.optionId, 80) : undefined;
  const bookingId = input.bookingId ? asString(input.bookingId, 64) : undefined;
  const quoteFingerprint = input.quoteFingerprint ? asString(input.quoteFingerprint, 128) : undefined;
  const serviceVersionId =
    input.serviceVersionId == null
      ? undefined
      : Number.isInteger(input.serviceVersionId) && input.serviceVersionId > 0
        ? input.serviceVersionId
        : null;
  if (input.serviceVersionId != null && serviceVersionId == null) return fail("MALFORMED_EVENT", "serviceVersionId");

  if (EVENTS_NEEDING_SERVICE.has(eventName) && !serviceId) return fail("MALFORMED_EVENT", "serviceId");
  if (EVENTS_NEEDING_VARIANT.has(eventName) && !variantId) return fail("MALFORMED_EVENT", "variantId");
  if (EVENTS_NEEDING_ADDON.has(eventName) && !addonId) return fail("MALFORMED_EVENT", "addonId");
  if (EVENTS_NEEDING_OPTION.has(eventName) && !optionId) return fail("MALFORMED_EVENT", "optionId");
  if (EVENTS_NEEDING_BOOKING.has(eventName) && !bookingId) return fail("MALFORMED_EVENT", "bookingId");

  let bookingOrigin: DataOrigin | null | undefined;
  let bookingServiceId: string | undefined;
  if (bookingId) {
    const booking = await prisma.booking.findUnique({
      where: { id: bookingId },
      select: { id: true, userId: true, serviceId: true, dataOrigin: true },
    });
    if (!booking) return fail("BOOKING_NOT_FOUND");
    if (actor && booking.userId !== actor.userId) return fail("BOOKING_ACTOR_MISMATCH");
    if (serviceId && booking.serviceId !== serviceId) return fail("BOOKING_SERVICE_MISMATCH");
    bookingOrigin = booking.dataOrigin;
    bookingServiceId = booking.serviceId;
  }

  const resolvedServiceId = serviceId ?? bookingServiceId;
  let stampedVersion: number | undefined = serviceVersionId ?? undefined;
  if (resolvedServiceId) {
    const service = await resolveService(resolvedServiceId, requireVisibleService && !bookingId);
    if (!service) {
      const exists = await prisma.service.findUnique({ where: { id: resolvedServiceId }, select: { id: true } });
      return fail(exists ? "SERVICE_NOT_VISIBLE" : "SERVICE_NOT_FOUND");
    }
    if (serviceVersionId != null && !(await versionExists(service.id, serviceVersionId, service.version))) {
      return fail("SERVICE_VERSION_NOT_FOUND");
    }
    if (stampedVersion == null) stampedVersion = service.version;
    if (variantId && !variantCodesOf(service).has(variantId)) return fail("VARIANT_NOT_ON_SERVICE");
    if (addonId && !addonCodesOf(service).has(addonId)) return fail("ADDON_NOT_ON_SERVICE");
    if (optionId && !optionValidOn(service, optionId)) return fail("OPTION_NOT_ON_SERVICE");
  }

  const dataOrigin = stampOrigin(actor, bookingOrigin);
  const metadata = sanitizeMetadata(input.metadata);

  try {
    const row = await prisma.analyticsEvent.create({
      data: {
        eventId,
        eventName,
        occurredAt,
        actorUserId: actor?.userId ?? null,
        sessionId: sessionId ?? null,
        serviceId: resolvedServiceId ?? null,
        serviceVersionId: stampedVersion ?? null,
        variantId: variantId ?? null,
        optionId: optionId ?? null,
        addonId: addonId ?? null,
        bookingId: bookingId ?? null,
        quoteFingerprint: quoteFingerprint ?? null,
        source,
        platform,
        environment: analyticsEnvironment(),
        dataOrigin,
        metadata,
      },
      select: { id: true },
    });
    logger.info("analytics_event_recorded", {
      eventName,
      eventId,
      duplicate: false,
      serviceId: resolvedServiceId ?? null,
      bookingId: bookingId ?? null,
      business: isBusinessRow(dataOrigin),
    });
    return { ok: true, duplicate: false, id: row.id, dataOrigin };
  } catch (err) {
    if (getPrismaErrorCode(err) === "P2002") {
      const existing = await prisma.analyticsEvent.findUnique({
        where: { eventId },
        select: { id: true, dataOrigin: true },
      });
      if (existing) return { ok: true, duplicate: true, id: existing.id, dataOrigin: existing.dataOrigin };
    }
    throw err;
  }
}

/** Public / customer ingest. Backend-only names are refused here so a client cannot mint them. */
export async function ingestClientEvent(input: AnalyticsEventInput, actor: ActorContext | null): Promise<IngestResult> {
  if (!CLIENT_SET.has(input.eventName)) {
    if (BACKEND_SET.has(input.eventName)) return fail("UNAUTHORIZED_EVENT");
    return fail("MALFORMED_EVENT", "eventName");
  }
  if (input.source === "BACKEND" || input.source === "ADMIN") return fail("MALFORMED_EVENT", "source");
  return persist({ input, actor, requireVisibleService: true });
}

/**
 * Authoritative producer path. Quote / booking / checkout / completion / cancel / repeat fire
 * from the service that already committed the fact. Callers must not use this to invent a
 * completed booking that does not exist.
 */
export async function recordAuthoritativeEvent(
  input: AnalyticsEventInput,
  actor: ActorContext | null,
): Promise<IngestResult> {
  if (!EVENT_NAMES.has(input.eventName)) return fail("MALFORMED_EVENT", "eventName");
  return persist({
    input: { ...input, source: input.source || "BACKEND", platform: input.platform || "SERVER" },
    actor,
    requireVisibleService: false,
    forceSource: SOURCES.includes(input.source as AnalyticsEventSource)
      ? (input.source as AnalyticsEventSource)
      : "BACKEND",
  });
}

export const analyticsEventsService = {
  ingestClientEvent,
  recordAuthoritativeEvent,
  analyticsEnvironment,
  CLIENT_INGESTIBLE_EVENTS,
  BACKEND_ONLY_EVENTS,
};
