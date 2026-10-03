/**
 * Thin bun-test wrapper. The suite itself runs in a child process so Bun does not
 * pre-bundle partner-lead + encryption into the test runner (that hang left the
 * filename printed and no test names).
 */
import { expect, test } from "bun:test";
import { resolve } from "node:path";

test(
  "P1/P2 integration runner against homigo_test",
  async () => {
    const proc = Bun.spawn({
      // Inherit the already-isolated test DATABASE_URL. Forcing --env-file=.env.test
      // rewrites the host to localhost, which is wrong inside Linux CI containers
      // that reach Postgres via a service hostname / host.docker.internal.
      cmd: [process.execPath, "src/__tests__/run-p1p2-integration.ts"],
      cwd: resolve(import.meta.dir, "../.."),
      stdout: "inherit",
      stderr: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "test",
        EVENTS_OUTBOX_ENABLED: "false",
        EVENTS_CONSUMERS_ENABLED: "false",
      },
    });
    const code = await proc.exited;
    expect(code).toBe(0);
  },
  { timeout: 180_000 },
);
