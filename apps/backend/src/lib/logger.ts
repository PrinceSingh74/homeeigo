/**
 * Structured logging with correlation IDs, trace context, and centralized storage.
 */

import type { AppLogCategory } from "@prisma/client";

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

function redact(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(meta)) {
    if (REDACT_KEYS.has(key.toLowerCase())) {
      out[key] = "[REDACTED]";
    } else if (value && typeof value === "object" && !Array.isArray(value) && !(value instanceof Date)) {
      out[key] = redact(value as Record<string, unknown>);
    } else {
      out[key] = value;
    }
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

  const safeMeta = meta ? redact(meta) : undefined;
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
