/**
 * Which Redis a process may use, given the database it is on.
 *
 * Redis here holds shared runtime state: the feature-flag cache, leader locks, rate limits, presence
 * and the WebSocket fan-out. None of its keys name a database, and environments are told apart only
 * by a name ("dev"). So two backends on DIFFERENT databases that share one Redis and one environment
 * name share all of it: each serves the other's flags, either can hold the other's leader lock, and
 * events cross between them.
 *
 * A process on an isolated database (its name contains "test": the suite's database, a rehearsal
 * copy, a browser-verification stack) therefore gets no Redis unless whoever launched it named one
 * explicitly. A dotenv file is not the launcher: `.env` is the developer's own environment, and its
 * Redis is exactly the one that must not be shared.
 *
 * Pure, and free of imports, because load-env runs it before anything else is loaded.
 */
export function redisUrlForDatabase(input: {
  databaseUrl: string | undefined;
  /** REDIS_URL as the launching process set it, before any dotenv file was read. */
  launcherRedisUrl: string | undefined;
  /** REDIS_URL after the dotenv files were applied. */
  effectiveRedisUrl: string | undefined;
}): { url: string; isolated: boolean } {
  const databaseName = (input.databaseUrl ?? "").split("/").pop()?.split("?")[0] ?? "";
  const launcher = input.launcherRedisUrl?.trim() ?? "";
  if (/test/i.test(databaseName) && !launcher) return { url: "", isolated: true };
  return { url: launcher || (input.effectiveRedisUrl ?? ""), isolated: false };
}
