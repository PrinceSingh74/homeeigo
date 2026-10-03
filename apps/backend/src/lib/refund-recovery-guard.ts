/**
 * ── Who may run automatic refund recovery ────────────────────────────────────────────────────────
 *
 * The recovery sweeps (stale gateway refunds, stranded cancellation refunds) move money and call the
 * payment gateway without a human. On 2026-09-19 a watch-mode dev server — `bun --env-file=.env run
 * --watch`, whose `.env` points at the live homigo_db and carries real Razorpay keys — hot-loaded a new
 * sweep and began working on live refund records within minutes. A plain on/off flag is not enough to
 * prevent a repeat: `.env` and `.env.local` are loaded with override:true, so one line added to a
 * shared file would switch it back on against live data.
 *
 * So the flag is necessary but never sufficient. Recovery runs only when, in order:
 *   1. REFUND_AUTO_RECOVERY_ENABLED is exactly "true";
 *   2. the database target can be read from DATABASE_URL (otherwise: fail closed);
 *   3. the target is a test database — or the process is a production runtime (NODE_ENV=production,
 *      which every deployment sets and no local dotenv file does) AND
 *      REFUND_AUTO_RECOVERY_AUTHORIZED_TARGET names this exact host:port/database. A mismatch, including
 *      an authorization written for some other database, fails closed.
 */
export type RefundRecoveryDecision = {
  enabled: boolean;
  reason:
    | "FLAG_OFF"
    | "TARGET_UNKNOWN"
    | "TEST_TARGET"
    | "NON_PRODUCTION_RUNTIME"
    | "TARGET_NOT_AUTHORIZED"
    | "AUTHORIZED_TARGET";
  target: string | null;
};

/** `host:port/database` of a Postgres URL, lower-cased; null if it cannot be read. */
export function databaseTarget(databaseUrl: string | undefined): string | null {
  if (!databaseUrl) return null;
  try {
    const u = new URL(databaseUrl);
    if (!/^postgres(ql)?:$/.test(u.protocol)) return null;
    const db = decodeURIComponent(u.pathname.replace(/^\//, ""));
    if (!u.hostname || !db) return null;
    return `${u.hostname.toLowerCase()}:${u.port || "5432"}/${db.toLowerCase()}`;
  } catch {
    return null;
  }
}

const isTestDatabase = (target: string) => /\/[a-z0-9_]*_test$/.test(target);

export function refundAutoRecoveryDecision(env: Record<string, string | undefined> = process.env): RefundRecoveryDecision {
  if (env.REFUND_AUTO_RECOVERY_ENABLED !== "true") return { enabled: false, reason: "FLAG_OFF", target: null };
  const target = databaseTarget(env.DATABASE_URL);
  if (!target) return { enabled: false, reason: "TARGET_UNKNOWN", target: null };
  if (isTestDatabase(target)) return { enabled: true, reason: "TEST_TARGET", target };
  if (env.NODE_ENV !== "production") return { enabled: false, reason: "NON_PRODUCTION_RUNTIME", target };
  const authorized = (env.REFUND_AUTO_RECOVERY_AUTHORIZED_TARGET ?? "").trim().toLowerCase();
  if (authorized !== target) return { enabled: false, reason: "TARGET_NOT_AUTHORIZED", target };
  return { enabled: true, reason: "AUTHORIZED_TARGET", target };
}
