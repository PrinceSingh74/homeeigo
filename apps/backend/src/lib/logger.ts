/**
 * Structured logging with correlation IDs, trace context, and centralized storage.
 */

import type { AppLogCategory } from "@prisma/client";
import { getEventContext } from "../events/core/event-context";

type LogLevel = "debug" | "info" | "warn" | "error";

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function resolveLevel(): LogLevel {
  const raw = (process.env.LOG_LEVEL || "").toLowerCase();
  if (raw in LEVELS) return raw as LogLevel;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

const MIN_LEVEL = LEVELS[resolveLevel()];
const IS_PROD = process.env.NODE_ENV === "production";
const RING_MAX = Number(process.env.LOG_RING_BUFFER_SIZE || 2000);

const REDACT_KEYS = new Set([
  "password",
  "newpassword",
  "currentpassword",
  "confirmpassword",
  "token",
  "accesstoken",
  "refreshtoken",
  "otp",
  "authorization",
  "secret",
  "razorpaysignature",
  "aadhaar",
  "aadhar",
  "pannumber",
  "bankaccount",
  "bankaccountnumber",
  "accountnumber",
  "ifsc",
  "cvv",
  "cardnumber",
  "kycsecret",
]);

export type LogContext = {
  requestId?: string;
  traceId?: string;
  spanId?: string;
  userId?: string;
  bookingId?: string;
  paymentId?: string;
  category?: AppLogCategory;
};

type RingEntry = {
  timestamp: string;
  level: LogLevel;
  message: string;
  category: AppLogCategory;
  requestId?: string;
  traceId?: string;
  userId?: string;
  bookingId?: string;
  paymentId?: string;
  meta?: Record<string, unknown>;
};

const ringBuffer: RingEntry[] = [];
let persistHandler: ((entry: RingEntry) => void) | null = null;

export function registerLogPersister(handler: (entry: RingEntry) => void): void {
  persistHandler = handler;
}

/**
 * Phase 14 §12 — scrub personal data out of free-form string values.
 *
 * `redact` below works on KEY names, which stops `{ password: "..." }` cold and does nothing at
 * all about `{ error: "...phone: '+919812345678'..." }`. That second shape is not hypothetical:
 * Prisma echoes the arguments of a failed call into its error message, so a validation error on a
 * `user.create` puts the email, phone and name straight into `err.message` — and this codebase
 * logs `err.message` in dozens of places, entirely reasonably.
 *
 * Demonstrated before writing this: a `prisma.user.create` carrying an unknown argument produced
 * a message containing the caller's phone number verbatim. A *database* constraint violation does
 * NOT do this — it names the field and not the value — so the leak is specific to Prisma's
 * client-side validation errors, and that is what this targets.
 *
 * Observability is deliberately preserved: the argument dump is replaced by the error kind that
 * identifies the failure, and the email/phone patterns are substituted in place rather than the
 * whole string being discarded.
 */
const PRISMA_ARG_ECHO = /Invalid `prisma\.[\w.]+\(\)` invocation/;
const PRISMA_ERROR_KIND =
  /(Unknown argument `[^`]+`|Argument `[^`]+` is missing|Unique constraint failed[^\n]*|Foreign key constraint violated[^\n]*|does not exist in the current database)/;
/**
 * Bounded on every side. The previous pattern (`[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}`)
 * backtracks quadratically on input like "aaaa…@aaaa…" with no dot, and error messages can carry
 * attacker-controlled text of arbitrary length (independent review, 2026-09-20). Real addresses are
 * far inside these bounds; the domain label class no longer contains the dot it must be followed by.
 */
const EMAIL_IN_TEXT = /[A-Za-z0-9._%+-]{1,64}@(?:[A-Za-z0-9-]{1,63}\.){1,8}[A-Za-z]{2,24}/g;
/**
 * Phone scrubbing = protect, then scrub, then restore.
 *
 * The greedy pattern below is deliberately broad (privacy first): any run of 10+ digits with
 * spaces/hyphens is masked, wherever it sits — `phone_9812345678`, `%2B919812345678`, two numbers
 * in a row. On its own it also rewrote identifiers operators search logs by: UUID fragments
 * (`f[phone]-a127-…` — which made the event-bus DLQ test fail whenever a random eventId contained
 * such a run), booking/withdrawal numbers (`HOMIGO-[phone]`) and timestamps. Those exact shapes are
 * shielded first and put back afterwards, so narrowing the phone pattern is never needed.
 */
const PHONE_IN_TEXT = /\+?\d[\d\s-]{8,}\d/g;
const PROTECTED_SHAPES = [
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, // UUID
  /\b[A-Z]{2,}-\d{8}-\d{3,}\b/g, // HOMIGO-YYYYMMDD-NNNNN, WXN-…, WD-…
  /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g, // ISO / Postgres timestamp
  /**
   * Long identifiers that mix letters and digits: trace/span ids, request ids, cuids, gateway ids
   * (`pay_…`, `order_dev_…`), hashes. A 32-hex trace id contains a 10+ digit run by chance about 8.5%
   * of the time, and the phone pattern rewrote exactly that part — seen live in the dev log as
   * `"traceId":"834e[phone]b9d164a74e3af62"`, which breaks log correlation for ~1 request in 12.
   *
   * These are matched by SHAPE, not by "looks like an id": a broad letters-and-digits rule also
   * swallowed `phone_9812345678`, which stopped a real phone being masked.
   */
  /\b(?=[0-9a-f]*[a-f])[0-9a-f]{16,}\b/gi, // trace/span ids, hashes: hex WITH a letter, so a 16-digit card is not shielded
  /\b(?:req|pay|order|evt|txn|rfnd|pl|sub|inv)_[0-9A-Za-z_]{6,}\b/g, // request + gateway ids
  /\bc[a-z0-9]{20,}\b/g, // cuid
];

/** Private-use markers used to shield identifiers while the phone pattern runs. */
const SHIELD_OPEN = "\uE000";
const SHIELD_CLOSE = "\uE001";

function scrubPhones(text: string): string {
  const shielded: string[] = [];
  // Strip any pre-existing placeholder characters from the input so user text cannot impersonate a
  // shield marker and splice a different value in on restore.
  let out = text.includes(SHIELD_OPEN) || text.includes(SHIELD_CLOSE)
    ? text.split(SHIELD_OPEN).join("").split(SHIELD_CLOSE).join("")
    : text;
  for (const re of PROTECTED_SHAPES) {
    out = out.replace(re, (m) => `${SHIELD_OPEN}${shielded.push(m) - 1}${SHIELD_CLOSE}`);
  }
  out = out.replace(PHONE_IN_TEXT, (m) => (m.replace(/\D/g, "").length >= 10 ? "[phone]" : m));
  // An unmatched index restores the original text rather than the string "undefined".
  return out.replace(
    new RegExp(`${SHIELD_OPEN}(\\d+)${SHIELD_CLOSE}`, "g"),
    (whole, i: string) => shielded[Number(i)] ?? whole,
  );
}

function scrubText(value: string): string {
  let out = value;
  if (PRISMA_ARG_ECHO.test(out)) {
    const kind = out.match(PRISMA_ERROR_KIND);
    out = `[prisma-error] ${kind ? kind[1] : "invocation failed"} (arguments withheld)`;
  }
  return scrubPhones(out.replace(EMAIL_IN_TEXT, "[email]"));
}

function redactValue(value: unknown): unknown {
  if (typeof value === "string") return scrubText(value);
  if (Array.isArray(value)) return value.map(redactValue);
  if (value && typeof value === "object" && !(value instanceof Date)) return redact(value as Record<string, unknown>);
  return value;
}

/**
 * Same redaction the log pipeline applies, exported so telemetry that leaves the machine (Sentry)
 * cannot carry what the logs refuse to: secret-named keys become [REDACTED] and free-text values are
 * scrubbed of emails and phone numbers.
 */
export function redactForTelemetry(meta: Record<string, unknown>): Record<string, unknown> {
  return redact(meta);
}

/** Scrub a free-text string (email/phone) exactly as a log value would be. */
export function scrubTextForTelemetry(value: string): string {
  return scrubText(value);
}

function redact(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    // Arrays were passed through untouched (`recipients: ["+91…"]` leaked) — now scrubbed element-wise.
    out[key] = REDACT_KEYS.has(key.toLowerCase()) ? "[REDACTED]" : redactValue(value);
  }
  return out;
}

function pushRing(entry: RingEntry): void {
  ringBuffer.push(entry);
  if (ringBuffer.length > RING_MAX) ringBuffer.shift();
  persistHandler?.(entry);
}

function emit(level: LogLevel, message: string, meta?: Record<string, unknown>): void {
  if (LEVELS[level] < MIN_LEVEL) return;

  const ctx = getEventContext();
  const enriched: Record<string, unknown> = {
    ...(ctx.requestId || ctx.correlationId
      ? { requestId: ctx.requestId ?? ctx.correlationId }
      : {}),
    ...(ctx.traceId ? { traceId: ctx.traceId } : {}),
    ...(ctx.actorId ? { actorId: ctx.actorId } : {}),
    ...(ctx.partnerId ? { partnerId: ctx.partnerId } : {}),
    ...(ctx.bookingId ? { bookingId: ctx.bookingId } : {}),
    ...(ctx.eventId ? { eventId: ctx.eventId } : {}),
    ...(ctx.deviceId ? { deviceId: ctx.deviceId } : {}),
    ...(meta ?? {}),
  };

  const safeMeta = Object.keys(enriched).length ? redact(enriched) : undefined;
  const timestamp = new Date().toISOString();
  const category = (safeMeta?.category as AppLogCategory | undefined) ?? "APPLICATION";

  const ringEntry: RingEntry = {
    timestamp,
    level,
    message,
    category,
    requestId: safeMeta?.requestId as string | undefined,
    traceId: safeMeta?.traceId as string | undefined,
    userId: safeMeta?.userId as string | undefined,
    bookingId: safeMeta?.bookingId as string | undefined,
    paymentId: safeMeta?.paymentId as string | undefined,
    meta: safeMeta,
  };
  pushRing(ringEntry);

  if (IS_PROD) {
    const line = JSON.stringify({ timestamp, level, message, category, ...(safeMeta ?? {}) });
    (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(line);
    return;
  }

  const tag = `[${level.toUpperCase()}]`;
  const metaStr = safeMeta && Object.keys(safeMeta).length ? ` ${JSON.stringify(safeMeta)}` : "";
  (level === "error" ? console.error : level === "warn" ? console.warn : console.log)(
    `${timestamp} ${tag} ${message}${metaStr}`,
  );
}

export function getRingBufferLogs(limit = 200): RingEntry[] {
  return ringBuffer.slice(-limit).reverse();
}

export const logger = {
  debug: (message: string, meta?: Record<string, unknown>) => emit("debug", message, meta),
  info: (message: string, meta?: Record<string, unknown>) => emit("info", message, meta),
  warn: (message: string, meta?: Record<string, unknown>) => emit("warn", message, meta),
  error: (message: string, meta?: Record<string, unknown>) => emit("error", message, meta),
};

export type { LogLevel, RingEntry };
