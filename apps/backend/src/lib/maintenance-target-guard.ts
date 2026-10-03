import { databaseTarget } from "./refund-recovery-guard";

/**
 * ── May this process run AUTONOMOUS maintenance against its database? ───────────────────────────────
 *
 * Autonomous maintenance is everything that writes without a user asking: ledger reconciliation and
 * backfill, integrity runs, refund retry/recovery, incentive crediting, settlement sync, account deletion,
 * retention and archival, backups, ETL, alerting, cleanup sweeps. The request path — and the runtime a
 * request depends on (event delivery, assignment dispatch, presence) — is not affected by this guard.
 *
 * Why it exists: `bun --env-file=.env run --watch` servers point at homigo_db through `.env`, and every
 * save restarts them. Each restart re-ran the boot-time jobs, so on 2026-09-19 the live database received
 * 134 ledger-backfill bookkeeping rows in twelve hours from processes nobody had asked to maintain it.
 * A developer's server must never maintain a live database merely because the shared dotenv file points
 * at it.
 *
 * Allowed only when:
 *   - the target is a test database (`*_test`), or
 *   - NODE_ENV=production and MAINTENANCE_AUTHORIZED_TARGET names this exact host:port/database
 *     (the deployment's explicit authorization; a mismatch fails closed and is reported as a boot
 *     degradation so /ready fails instead of a deployment silently running without maintenance), or
 *   - a non-production runtime (staging, a local clone) whose MAINTENANCE_LOCAL_OPT_IN_TARGET names this
 *     exact target — a deliberate, target-bound choice, never implied by the database URL alone.
 * An unreadable target fails closed.
 */
export type MaintenanceDecision = {
  enabled: boolean;
  reason:
    | "TARGET_UNKNOWN"
    | "TEST_TARGET"
    | "AUTHORIZED_TARGET"
    | "TARGET_NOT_AUTHORIZED"
    | "LOCAL_OPT_IN"
    | "NON_PRODUCTION_RUNTIME";
  target: string | null;
  /** True when the refusal must be surfaced as a boot degradation (a production runtime left unmaintained). */
  degradeBoot: boolean;
};

const isTestDatabase = (target: string) => /\/[a-z0-9_]*_test$/.test(target);
const norm = (v: string | undefined) => (v ?? "").trim().toLowerCase();

export function maintenanceWriteDecision(env: Record<string, string | undefined> = process.env): MaintenanceDecision {
  const target = databaseTarget(env.DATABASE_URL);
  if (!target) return { enabled: false, reason: "TARGET_UNKNOWN", target: null, degradeBoot: env.NODE_ENV === "production" };
  if (isTestDatabase(target)) return { enabled: true, reason: "TEST_TARGET", target, degradeBoot: false };
  if (env.NODE_ENV === "production") {
    return norm(env.MAINTENANCE_AUTHORIZED_TARGET) === target
      ? { enabled: true, reason: "AUTHORIZED_TARGET", target, degradeBoot: false }
      : { enabled: false, reason: "TARGET_NOT_AUTHORIZED", target, degradeBoot: true };
  }
  return norm(env.MAINTENANCE_LOCAL_OPT_IN_TARGET) === target
    ? { enabled: true, reason: "LOCAL_OPT_IN", target, degradeBoot: false }
    : { enabled: false, reason: "NON_PRODUCTION_RUNTIME", target, degradeBoot: false };
}
