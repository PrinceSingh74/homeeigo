#!/usr/bin/env node
/**
 * `next dev` + the route warmer, as ONE command — so the warm-up cannot be forgotten.
 *
 * The warmer (scripts/dev-warm.mjs) has existed since 2026-09-17 and pays each route's first-hit
 * compile bill in the background instead of mid-navigation. But it only helped when somebody
 * remembered to run it in a second terminal — nobody did, so every dev restart brought the
 * "navigation is slow again" report back (measured: a nav-bar route's first hit costs 1.1-4.3s to
 * compile; after an edit that invalidates the graph, up to 43s was observed on /services).
 *
 * This wrapper spawns `next dev` with the exact arguments it was given (so `-p`, `-H`,
 * `--turbopack` all pass through), pipes its output untouched, and runs the warmer once the port
 * answers. Killing this process kills the dev server with it. The warmer stays what it is — a
 * client of the dev server; if it fails, dev behaves exactly as before.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const portFlag = args.indexOf("-p");
const port = portFlag >= 0 ? args[portFlag + 1] : (process.env.PORT ?? "3001");

const next = spawn("npx", ["next", "dev", ...args], {
  cwd: join(here, ".."),
  stdio: "inherit",
  shell: process.platform === "win32",
});
next.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    next.kill(sig);
  });
}

// The warmer polls the origin itself (BOOT_TIMEOUT_MS) and exits when done; run it detached from
// the dev server's lifetime but in our process group, silenced unless it has something to say.
const warm = spawn(process.execPath, [join(here, "dev-warm.mjs")], {
  cwd: join(here, ".."),
  env: { ...process.env, WARM_ORIGIN: `http://127.0.0.1:${port}` },
  stdio: ["ignore", "inherit", "inherit"],
  shell: false,
});
warm.on("error", () => {
  /* warm-up is best-effort by design */
});
