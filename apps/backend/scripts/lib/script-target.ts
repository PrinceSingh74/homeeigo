/**
 * A script that writes business-shaped rows must say which database it is aiming at.
 *
 * WHY
 * ---
 * On 2026-09-24 the live database held 3 OPEN CRITICAL safety incidents, 173 bookings with numbers
 * the booking-number generator never minted (`S03L-…`, `S07-…`, `ADV-…`), and 81 accounts on
 * `homigo.demo`. Every one was created by a certification or demo script that loaded `.env` through
 * `dotenv/config` and therefore reached `homigo_db` by default. None of the scripts was wrong about
 * what it did; each was wrong about *where*. The DDL guard (`src/lib/ddl-target-guard.ts`) covers
 * schema-level operations; this covers the ordinary service-layer writes those scripts make.
 *
 * RULE
 * ----
 * A test database (name contains "test") is always allowed. Anything else needs the explicit flag
 * `--allow-live` on the command line — a deliberate act that shows up in shell history — and the
 * script announces the target either way. No environment variable can grant it, so an inherited
 * shell cannot silently widen the scope.
 */
export type ScriptTarget = { database: string; live: boolean };

export function parseDatabaseName(rawUrl: string | undefined | null): string | null {
  if (!rawUrl) return null;
  try {
    const u = new URL(rawUrl);
    const name = u.pathname.replace(/^\//, "").split("?")[0] ?? "";
    return name || null;
  } catch {
    return null;
  }
}

export function requireDeclaredTarget(opts: { argv?: string[]; env?: NodeJS.ProcessEnv; label?: string } = {}): ScriptTarget {
  const argv = opts.argv ?? process.argv;
  const env = opts.env ?? process.env;
  const database = parseDatabaseName(env.DATABASE_URL);
  if (!database) {
    console.error(`[script-target] REFUSING: DATABASE_URL is missing or unparseable; this script writes rows and must know its target.`);
    process.exit(2);
  }
  const live = !/test/i.test(database);
  if (live && !argv.includes("--allow-live")) {
    console.error(
      `[script-target] REFUSING: "${database}" is not a test database.\n` +
        `  This script creates business-shaped rows (bookings, users, incidents). Run it against a test\n` +
        `  database, or pass --allow-live to state on the command line that the live database is intended.`,
    );
    process.exit(2);
  }
  console.log(`[script-target] ${opts.label ?? "script"} → "${database}"${live ? " (LIVE — --allow-live given)" : " (test)"}`);
  return { database, live };
}
