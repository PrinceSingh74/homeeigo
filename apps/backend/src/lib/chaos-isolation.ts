import { resolvePrismaDatasourceUrl } from "./database-url";

/**
 * Refuses to let a load, chaos or volume scenario run against anything but an isolated database.
 *
 * ── Why a second barrier ────────────────────────────────────────────────────
 *
 * `prisma-base.ts` already refuses to construct a client when `NODE_ENV === "test"` and the URL is
 * not isolated. That covers `bun test`, because Bun sets NODE_ENV itself. It does NOT cover a script
 * run with `bun run`, which leaves NODE_ENV as "development" and therefore resolves `.env` — the
 * LIVE database. That gap is not hypothetical: a benchmark in this project was run that way and
 * spent its whole execution querying `homigo_db`, and separately a `prisma db execute` against the
 * live database deleted ~3,939 rows of completed scheduled-job history.
 *
 * Section 7 is deliberately write-heavy: saturation, duplicate execution, crash recovery, financial
 * side-effect chaos. Any one of those pointed at production is not a bad test run, it is an
 * incident. So the check keys on INTENT rather than on an environment variable that the harness
 * cannot control: a file that calls this is declaring itself destructive, and the call throws unless
 * the target is demonstrably disposable.
 *
 * ── What counts as isolated ─────────────────────────────────────────────────
 *
 * The database name must contain "test", or be one of the named scratch databases. This is the same
 * rule `prisma-base` applies, stated once here so the two cannot drift into disagreeing about what
 * "safe" means. Anything unparseable, empty, or merely unfamiliar is refused: a barrier that fails
 * open is decoration.
 */

/** Scratch databases that are not named "*test*" but are disposable by agreement. */
const NAMED_SCRATCH_DATABASES = new Set(["homigo_p39"]);

export type ChaosTarget = {
  databaseName: string;
  host: string;
  port: string;
  /** The URL with credentials removed — safe to print in evidence. */
  redacted: string;
};

export function describeDatabaseTarget(url = resolvePrismaDatasourceUrl()): ChaosTarget | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const databaseName = parsed.pathname.replace(/^\//, "").split("?")[0] ?? "";
    if (!databaseName) return null;
    return {
      databaseName,
      host: parsed.hostname,
      port: parsed.port || "5432",
      redacted: `${parsed.protocol}//${parsed.username || "?"}:***@${parsed.host}/${databaseName}`,
    };
  } catch {
    return null;
  }
}

export function isIsolatedDatabase(name: string): boolean {
  return /test/i.test(name) || NAMED_SCRATCH_DATABASES.has(name);
}

/**
 * Call at the top of any script that generates load, injects failure, or writes volume.
 *
 * Throws — never returns false, never warns. A scenario that can proceed after a failed safety
 * check has no safety check; the only useful behaviour is to stop the process before the first
 * write.
 *
 * `scenario` appears in the error so that a refusal names which harness was about to do what.
 */
export function assertChaosTargetIsolated(scenario: string): ChaosTarget {
  const target = describeDatabaseTarget();
  if (!target) {
    throw new Error(
      `CHAOS SAFETY: "${scenario}" refused — DATABASE_URL is missing or unparseable, so the target ` +
        "cannot be shown to be disposable. Set DATABASE_URL to an isolated database explicitly.",
    );
  }
  if (!isIsolatedDatabase(target.databaseName)) {
    throw new Error(
      `CHAOS SAFETY: "${scenario}" refused — DATABASE_URL points at "${target.databaseName}" ` +
        `(${target.redacted}), which is not an isolated database.\n` +
        "  Load and chaos scenarios write, duplicate, saturate and crash on purpose. Run them " +
        "against a database whose name contains \"test\":\n" +
        "    DATABASE_URL=\"$(grep ^DATABASE_URL apps/backend/.env.test | cut -d= -f2-)\" bun run <script>\n" +
        "  This barrier keys on intent, not NODE_ENV, precisely because `bun run` leaves NODE_ENV " +
        "as \"development\" and would otherwise resolve the live database.",
    );
  }
  return target;
}

/**
 * Redis instances a chaos scenario is allowed to stop, block or saturate.
 *
 * Identified by PORT rather than by container name, because the port is what a connection string
 * actually carries and is therefore the thing a harness can be wrong about. 6379 is the shared
 * developer instance every local app connects to; stopping it during a failure-injection run would
 * take down whatever else is using it, which is an outage rather than an experiment.
 */
const ISOLATED_REDIS_PORTS = new Set(["6380"]);

export type RedisTarget = { host: string; port: string; db: string; redacted: string };

export function describeRedisTarget(url = process.env.REDIS_URL ?? ""): RedisTarget | null {
  if (!url.trim()) return null;
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parsed.port || "6379",
      db: parsed.pathname.replace(/^\//, "") || "0",
      redacted: `${parsed.protocol}//${parsed.host}${parsed.pathname}`,
    };
  } catch {
    return null;
  }
}

/**
 * Call before stopping, blocking, delaying or otherwise attacking Redis.
 *
 * Throws rather than returning false, and throws on an unparseable or absent URL too: a scenario
 * that cannot name its target must not be allowed to guess, because the default guess on this
 * machine is the shared instance on 6379.
 */
export function assertRedisTargetIsolated(scenario: string, url = process.env.REDIS_URL ?? ""): RedisTarget {
  const target = describeRedisTarget(url);
  if (!target) {
    throw new Error(
      `CHAOS SAFETY: "${scenario}" refused — REDIS_URL is missing or unparseable, so the Redis ` +
        "target cannot be shown to be disposable. Set it explicitly to the isolated instance.",
    );
  }
  if (!ISOLATED_REDIS_PORTS.has(target.port)) {
    throw new Error(
      `CHAOS SAFETY: "${scenario}" refused — REDIS_URL points at ${target.redacted} (port ` +
        `${target.port}), which is not an isolated Redis. Port 6379 is the shared developer ` +
        `instance; stopping it is an outage, not an experiment. Use the isolated instance ` +
        `(redis://localhost:6380).`,
    );
  }
  return target;
}

/**
 * The same assertion for a harness that drives a RUNNING SERVER over HTTP rather than a Prisma
 * client of its own.
 *
 * A load runner pointed at `http://localhost:3000` inherits whatever database that server was
 * started with, and nothing in the runner's own environment reveals it. So the server is asked:
 * `/health` (or the supplied path) must report a database whose name is isolated. If the server
 * will not say, the run is refused rather than assumed safe.
 */
export async function assertServerTargetIsolated(
  baseUrl: string,
  scenario: string,
  probePath = "/health",
): Promise<ChaosTarget> {
  let body: unknown;
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}${probePath}`, {
      signal: AbortSignal.timeout(10_000),
    });
    body = await res.json();
  } catch (err) {
    throw new Error(
      `CHAOS SAFETY: "${scenario}" refused — could not reach ${baseUrl}${probePath} to confirm which ` +
        `database that server is using (${err instanceof Error ? err.message : String(err)}).`,
      { cause: err },
    );
  }

  /**
   * The verdict is read from the ONE field built for it, not sniffed out of the payload.
   *
   * The first version walked the health JSON looking for any key called `database` and treating its
   * value as the name. `/health` reports `services.database: "ok"` — a liveness word, not an
   * identifier — so the check refused a correctly-isolated server on the grounds that it was
   * connected to a database called "ok". It failed closed, which is the right direction to be wrong
   * in, but it was still wrong: a safety check that cries wolf is one people route around.
   */
  const isolated = (body as { isolatedDatabase?: unknown } | null)?.isolatedDatabase;
  if (typeof isolated !== "boolean") {
    throw new Error(
      `CHAOS SAFETY: "${scenario}" refused — ${baseUrl}${probePath} did not report ` +
        "`isolatedDatabase`, so the target cannot be shown to be disposable. That field is added by " +
        "the backend's /health route; an older build, or a different service, will not have it.",
    );
  }
  if (!isolated) {
    throw new Error(
      `CHAOS SAFETY: "${scenario}" refused — the server at ${baseUrl} reports ` +
        "`isolatedDatabase: false`. It is attached to a database that is not disposable. Start a " +
        "server explicitly against an isolated database and point the harness at that.",
    );
  }
  return {
    databaseName: "(isolated)",
    host: baseUrl,
    port: "",
    redacted: `${baseUrl} -> isolatedDatabase: true`,
  };
}
