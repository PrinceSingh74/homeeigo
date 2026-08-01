/**
 * HOMIGO ENTERPRISE LOG GOVERNANCE — single source of truth for what may touch the database.
 *
 * The log explosion (699 MB of WARN/INFO) must never return. This module makes that structurally
 * impossible: the persister calls `evaluateLogPersistence()` and ONLY ERROR/CRITICAL can ever pass,
 * a per-signature rate limiter caps storms, and `assertLogGovernance()` HARD-FAILS startup if anyone
 * tries to configure INFO/WARN/DEBUG → DB.
 */

export type LogLevel = "debug" | "info" | "warn" | "error" | "critical";

export interface LogTier {
  level: LogLevel;
  /** may this level be written to Postgres? */
  db: boolean;
  /** retention in days for DB-persisted levels (0 = never stored) */
  retentionDays: number;
  destinations: string[];
}

// PHASE 1 — classification engine. The `db` flag is the law; everything downstream derives from it.
export const LOG_TIERS: Record<LogLevel, LogTier> = {
  debug: { level: "debug", db: false, retentionDays: 0, destinations: ["console"] },
  info: { level: "info", db: false, retentionDays: 7, destinations: ["console", "file"] },
  warn: { level: "warn", db: false, retentionDays: 14, destinations: ["console", "file"] },
  error: { level: "error", db: true, retentionDays: 30, destinations: ["postgres", "sentry"] },
  critical: { level: "critical", db: true, retentionDays: 90, destinations: ["postgres", "sentry", "pagerduty"] },
};

/** The ONLY levels permitted to persist to Postgres. Derived from the tiers — not configurable away. */
export const DB_PERSIST_ALLOWLIST: ReadonlySet<LogLevel> = new Set(
  (Object.values(LOG_TIERS).filter((t) => t.db).map((t) => t.level) as LogLevel[]),
);

export function normalizeLevel(level: string): LogLevel | null {
  const l = String(level).trim().toLowerCase();
  return (l in LOG_TIERS ? (l as LogLevel) : l === "fatal" ? "critical" : null);
}

// PHASE 2 — startup guardrail. Refuse to boot if config would re-enable the explosion.
export function assertLogGovernance(): void {
  const raw = process.env.LOG_DB_PERSIST_LEVELS;
  // default is the allowlist itself; an explicit override is validated against it
  const configured = (raw ?? Array.from(DB_PERSIST_ALLOWLIST).join(","))
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  const illegal = configured.filter((l) => !DB_PERSIST_ALLOWLIST.has(l as LogLevel));
  if (illegal.length > 0) {
    const msg =
      `[log-governance] FATAL: LOG_DB_PERSIST_LEVELS contains non-allowed level(s): ${illegal.join(", ")}. ` +
      `Only ERROR and CRITICAL may persist to the database (INFO/WARN/DEBUG → console/file/Loki only). ` +
      `Refusing to start to prevent unbounded log growth.`;
    // eslint-disable-next-line no-console
    console.error(msg);
    throw new Error(msg);
  }
}

// PHASE 3 — log storm protection. Per-signature sliding window: first N writes/min persist, the rest
// are aggregated in memory (count/first_seen/last_seen) instead of inserting millions of rows.
const RATE_MAX_WRITES_PER_MIN = Number(process.env.LOG_SIGNATURE_MAX_PER_MIN || 10);
const RATE_WINDOW_MS = 60_000;

interface SignatureState {
  windowStart: number;
  written: number;
  suppressed: number;
  firstSeen: number;
  lastSeen: number;
}
const signatureWindows = new Map<string, SignatureState>();

export interface PersistenceDecision {
  persist: boolean;
  reason: "allowed" | "level_not_allowed" | "rate_limited";
  level: LogLevel | null;
  signature?: string;
  /** when rate-limited, the running aggregate for this signature in the current window */
  aggregate?: { count: number; suppressed: number; firstSeen: number; lastSeen: number };
}

export function buildSignature(level: string, category: string, message: string): string {
  // collapse volatile tokens (ids, numbers, uuids) so "user 123 failed" === "user 456 failed"
  const norm = String(message)
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/g, "<uuid>")
    .replace(/\b\d+\b/g, "<n>")
    .slice(0, 120);
  return `${level}|${category}|${norm}`;
}

/** Single decision point used by the persister. ENFORCES the allowlist + the rate limiter. */
export function evaluateLogPersistence(rawLevel: string, category: string, message: string): PersistenceDecision {
  const level = normalizeLevel(rawLevel);
  if (!level || !DB_PERSIST_ALLOWLIST.has(level)) {
    return { persist: false, reason: "level_not_allowed", level };
  }
  const signature = buildSignature(level, category, message);
  const now = Date.now();
  let s = signatureWindows.get(signature);
  if (!s || now - s.windowStart >= RATE_WINDOW_MS) {
    s = { windowStart: now, written: 0, suppressed: 0, firstSeen: now, lastSeen: now };
    signatureWindows.set(signature, s);
  }
  s.lastSeen = now;
  if (s.written < RATE_MAX_WRITES_PER_MIN) {
    s.written += 1;
    return { persist: true, reason: "allowed", level, signature };
  }
  s.suppressed += 1;
  return {
    persist: false,
    reason: "rate_limited",
    level,
    signature,
    aggregate: { count: s.written + s.suppressed, suppressed: s.suppressed, firstSeen: s.firstSeen, lastSeen: s.lastSeen },
  };
}

/** PHASE 9 — capacity forecast from a measured daily rate. */
export function forecastLogGrowth(rowsPerDay: number, bytesPerRow: number, retentionDays = 30) {
  const dailyMB = (rowsPerDay * bytesPerRow) / 1_048_576;
  const horizon = (d: number) => ({
    unboundedMB: Math.round(dailyMB * d),
    boundedMB: Math.round(dailyMB * Math.min(d, retentionDays)),
  });
  return {
    rowsPerDay,
    bytesPerRow,
    dailyMB: Number(dailyMB.toFixed(3)),
    retentionDays,
    d30: horizon(30),
    d90: horizon(90),
    d180: horizon(180),
    d365: horizon(365),
  };
}

// PHASE 8 — self-healing thresholds (MB).
export const SELF_HEAL_THRESHOLDS = { warn: 100, archive: 250, emergency: 500, critical: 1024 } as const;
export type SelfHealAction = "ok" | "warn" | "archive" | "emergency_cleanup" | "critical_alert";

export function classifyTableSize(sizeMB: number): SelfHealAction {
  if (sizeMB >= SELF_HEAL_THRESHOLDS.critical) return "critical_alert";
  if (sizeMB >= SELF_HEAL_THRESHOLDS.emergency) return "emergency_cleanup";
  if (sizeMB >= SELF_HEAL_THRESHOLDS.archive) return "archive";
  if (sizeMB >= SELF_HEAL_THRESHOLDS.warn) return "warn";
  return "ok";
}
