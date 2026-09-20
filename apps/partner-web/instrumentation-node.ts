/**
 * Node-only helpers for `instrumentation.ts`.
 *
 * Keep Node APIs out of `instrumentation.ts` — Next compiles that file for Edge too.
 * `scripts/check-instrumentation-edge.mjs` fails the build if they leak back.
 *
 * Opt out with WARM_ROUTES=0.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LOCK = () => join(process.cwd(), ".next", "dev-warm.pid");

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function stopStaleWarmer(): void {
  const file = LOCK();
  if (!existsSync(file)) return;
  try {
    const pid = Number(readFileSync(file, "utf8").trim());
    if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && pidAlive(pid)) {
      try {
        process.kill(pid);
      } catch {
        // Already gone between the liveness check and the kill.
      }
    }
  } catch {
    // Corrupt lock — ignore and overwrite.
  }
  try {
    unlinkSync(file);
  } catch {
    // Nothing to clear.
  }
}

export function warmRoutesInBackground(): void {
  if (process.env.NODE_ENV !== "development") return;
  if (process.env.WARM_ROUTES === "0" || process.env.NEXT_PHASE === "phase-production-build") return;

  try {
    stopStaleWarmer();
    mkdirSync(join(process.cwd(), ".next"), { recursive: true });

    const child = spawn(process.execPath, [join(process.cwd(), "scripts", "dev-warm.mjs")], {
      // Never detach: orphaned warmers on Windows compile-storm the next `next dev` until it 500s.
      detached: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    child.stdout?.on("data", (buf: Buffer) => {
      process.stdout.write(buf);
    });
    child.stderr?.on("data", (buf: Buffer) => {
      process.stderr.write(buf);
    });
    child.on("exit", () => {
      try {
        unlinkSync(LOCK());
      } catch {
        // Lock already cleared.
      }
    });

    if (child.pid) writeFileSync(LOCK(), String(child.pid));
  } catch {
    // A warm-up that fails is a dev server that is merely as slow as it was before.
  }
}
