/**
 * DDL / maintenance-script target guard.
 *
 * ── The incident this exists to prevent ──────────────────────────────────────
 *
 * On 2026-09-16 a hand-scoped migration containing DELETE statements was executed with
 * `bunx prisma db execute --file …` after `set -a; . ./.env.test`. It ran against the LIVE local
 * `homigo_db` and removed 3,939 historical `scheduled_jobs` rows. Two independent causes lined up:
 *
 *   1. `prisma.config.ts` does `import "dotenv/config"`, which reads `.env` — NOT `.env.test`,
 *      and not `.env.local` either. So the Prisma CLI resolves the LIVE url unless `--url` is
 *      passed explicitly. Nothing warns about this.
 *   2. The `.env.test` url contains `&pool_timeout=30`. In a POSIX shell an unquoted `&` is a
 *      background operator, so `. ./.env.test` never exported DATABASE_URL at all. The override
 *      failed silently and the previous (live) value stayed in place.
 *
 * `src/lib/prisma-base.ts` already refuses to construct a client against a non-test database when
 * `NODE_ENV=test`. That covers `bun test`. It does NOT cover a maintenance script run by hand,
 * where NODE_ENV is "development" and the live database is the legitimate default for most work.
 *
 * ── What this guard does ─────────────────────────────────────────────────────
 *
 * It refuses to let a script *guess* which database it is mutating. The caller must state its
 * intent, and the resolved url must match that intent:
 *
 *   assertDdlTarget("test")      → url's database name must contain "test"
 *   assertDdlTarget("live")      → url must NOT be a test database, and HOMIGO_DDL_CONFIRM must
 *                                  name that exact database (so a typo, a stale shell, or a
 *                                  forgotten `.env` cannot stand in for a decision)
 *
 * It is deliberately NOT a blanket ban on touching the live database: ops scripts legitimately do
 * that. It bans doing so *without having said so*.
 */

export type DdlIntent = "test" | "live";

export type DdlTarget = {
  /** Database name parsed out of the url (never the credentials). */
  database: string;
  /** Url with the password replaced, safe to print. */
  redacted: string;
  isTestDatabase: boolean;
};

/**
 * Databases that are isolated by construction but do not carry "test" in the name. Each entry is
 * an exact name, never a pattern: a pattern like /cert/ would also admit a future "homigo_cert_prod".
 *   homigo_p39          — historical local clone, same as `prisma-base.ts`
 *   homigo_cert_migrate — disposable database that certify-fresh-migrate.ts drops and rebuilds
 *                         from migrations on every run; it holds no data anyone owns
 */
const ISOLATED_ALIASES = new Set(["homigo_p39", "homigo_cert_migrate"]);

export function parseDdlTarget(rawUrl: string | undefined | null): DdlTarget | null {
  const raw = (rawUrl ?? "").trim();
  if (!raw) return null;
  let database: string;
  let redacted: string;
  try {
    const url = new URL(raw);
    database = url.pathname.replace(/^\//, "").split("?")[0] ?? "";
    if (url.password) url.password = "***";
    redacted = url.toString();
  } catch {
    // A malformed url is not something to guess at — the caller gets `null` and must refuse.
    return null;
  }
  if (!database) return null;
  return {
    database,
    redacted,
    isTestDatabase: /test/i.test(database) || ISOLATED_ALIASES.has(database),
  };
}

export class DdlTargetRefusal extends Error {
  readonly code = "DDL_TARGET_REFUSED";
  constructor(message: string) {
    super(message);
    this.name = "DdlTargetRefusal";
  }
}

/**
 * Resolve and verify the database a maintenance script is about to mutate.
 *
 * @param intent  What the script believes it is touching.
 * @param rawUrl  The url it will actually connect with. Omit the argument entirely to fall back to
 *                `process.env.DATABASE_URL` (the value the Prisma CLI would also use). Passing an
 *                explicit `undefined`/`null`/`""` is NOT the same thing: it means the caller looked
 *                for a url and did not find one, which is always a refusal. A default parameter
 *                cannot tell those apart — `arguments.length` can, and the difference matters:
 *                silently substituting the ambient (usually live) url for a url the caller failed
 *                to resolve is precisely the substitution that caused the 2026-09-16 incident.
 * @throws DdlTargetRefusal when the url is absent, malformed, or does not match the intent.
 */
export function assertDdlTarget(intent: DdlIntent, ...rest: [rawUrl?: string | null]): DdlTarget {
  const rawUrl = rest.length === 0 ? process.env.DATABASE_URL : rest[0];
  const target = parseDdlTarget(rawUrl);

  if (!target) {
    throw new DdlTargetRefusal(
      `REFUSING: no usable DATABASE_URL for a "${intent}" operation. ` +
        "An absent or malformed url means the target is unknown, and an unknown target is never safe to write to. " +
        'Pass an explicit url, or set DATABASE_URL to a well-formed "postgresql://…/<database>".',
    );
  }

  if (intent === "test") {
    if (!target.isTestDatabase) {
      throw new DdlTargetRefusal(
        `REFUSING: this operation is only for an isolated test database, but DATABASE_URL names "${target.database}".\n` +
          "  Do NOT rely on sourcing .env.test in a shell: its url contains '&', which the shell reads as a\n" +
          "  background operator, so the export silently does nothing. Prisma's own config loads .env (the LIVE\n" +
          "  database) via dotenv.\n" +
          "  Use: bun run db:execute:test <file>   (reads .env.test itself and passes --url explicitly)",
      );
    }
    return target;
  }

  // intent === "live"
  if (target.isTestDatabase) {
    throw new DdlTargetRefusal(
      `REFUSING: this operation declares intent "live", but DATABASE_URL names the test database "${target.database}". ` +
        "Running a live maintenance script against the test database is usually a stale shell, and its result would be meaningless.",
    );
  }
  const confirm = (process.env.HOMIGO_DDL_CONFIRM ?? "").trim();
  if (confirm !== target.database) {
    throw new DdlTargetRefusal(
      `REFUSING: about to mutate the LIVE database "${target.database}" (${target.redacted}).\n` +
        "  This is not blocked, but it must be stated — a forgotten shell, a default .env, or a copied command\n" +
        "  must not be enough to reach live data.\n" +
        `  To proceed, name the database you mean:  HOMIGO_DDL_CONFIRM=${target.database} <command>`,
    );
  }
  return target;
}

/** Print the verified target so the operator sees what a script is about to touch. */
export function announceDdlTarget(label: string, target: DdlTarget): void {
  console.log(`[ddl-guard] ${label} → ${target.database} (${target.redacted})`);
}
