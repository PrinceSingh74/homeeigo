/**
 * Startup guard for APP_ENV=staging — refuse known production-mutable targets.
 * Mirrors the test-mode DATABASE guard in load-env.ts.
 */

export type StagingSafetyViolation = { key: string; message: string };

function databaseNameFromUrl(url: string): string {
  return url.split("/").pop()?.split("?")[0] ?? "";
}

function redactDatabaseUrl(url: string): string {
  return url.replace(/:\/\/([^:]+):[^@]+@/, "://$1:****@");
}

export function validateStagingSafety(): StagingSafetyViolation[] {
  if (process.env.APP_ENV !== "staging") return [];

  const errors: StagingSafetyViolation[] = [];
  const dbUrl = process.env.DATABASE_URL?.trim() ?? "";
  const dbName = databaseNameFromUrl(dbUrl);

  if (!dbUrl) {
    errors.push({ key: "DATABASE_URL", message: "DATABASE_URL is required when APP_ENV=staging" });
  } else {
    if (dbName === "homigo_db") {
      errors.push({
        key: "DATABASE_URL",
        message:
          "staging must not use the local dev database homigo_db — use homigo_staging_db or a cloud staging instance",
      });
    }
    if (/prod/i.test(dbName) && !/staging/i.test(dbName)) {
      errors.push({
        key: "DATABASE_URL",
        message: `staging database name "${dbName}" looks like production — use a dedicated staging database`,
      });
    }
  }

  const blockedHosts = (process.env.STAGING_BLOCKED_DB_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  if (dbUrl && blockedHosts.length > 0) {
    const lower = dbUrl.toLowerCase();
    for (const host of blockedHosts) {
      if (lower.includes(host)) {
        errors.push({
          key: "DATABASE_URL",
          message: `staging DATABASE_URL matches blocked production host pattern "${host}"`,
        });
      }
    }
  }

  const razorpayKeyId = process.env.RAZORPAY_KEY_ID?.trim() ?? "";
  if (razorpayKeyId.startsWith("rzp_live_")) {
    errors.push({
      key: "RAZORPAY_KEY_ID",
      message: "staging must not use live Razorpay credentials (rzp_live_*)",
    });
  }

  if (process.env.RAZORPAY_ACCOUNT_NUMBER?.trim()) {
    errors.push({
      key: "RAZORPAY_ACCOUNT_NUMBER",
      message: "staging must not configure RazorpayX payout account numbers",
    });
  }

  if (process.env.EVENTS_OUTBOX_ENABLED === "true" || process.env.EVENTS_CONSUMERS_ENABLED === "true") {
    errors.push({
      key: "EVENTS",
      message:
        "Phase 0 event flags must remain disabled in staging baseline (EVENTS_OUTBOX_ENABLED=false, EVENTS_CONSUMERS_ENABLED=false)",
    });
  }

  return errors;
}

export function assertStagingSafety(): void {
  const errors = validateStagingSafety();
  if (errors.length === 0) return;

  const dbUrl = process.env.DATABASE_URL ?? "";
  const detail = errors.map((e) => `${e.key}: ${e.message}`).join("; ");
  throw new Error(
    `[staging-safety] REFUSING to start — ${detail} (db=${databaseNameFromUrl(dbUrl)}, url=${redactDatabaseUrl(dbUrl)})`,
  );
}
