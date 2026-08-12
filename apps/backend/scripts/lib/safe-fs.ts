/**
 * Cross-platform safe directory creation — idempotent on Windows/Linux/macOS/CI.
 *
 * Bun on Windows throws EEXIST for `mkdir(..., { recursive: true })` when the
 * target already exists as a OneDrive reparse-point directory (ReadOnly +
 * ReparsePoint). Node is idempotent in that case. We stat/existsSync first and
 * treat EEXIST as success only when the path is already a directory.
 */
import { existsSync, lstatSync } from "node:fs";
import { mkdir, stat, unlink, readdir, rm } from "node:fs/promises";
import { join } from "node:path";

export type PathKind = "missing" | "directory" | "file" | "other";

export type PathInspection = {
  path: string;
  exists: boolean;
  kind: PathKind;
};

export type EnsureDirResult = {
  path: string;
  existedBefore: boolean;
  kindBefore: PathKind;
  action: "already_directory" | "created" | "replaced_file";
};

export type EnsureDirOptions = {
  /** Emit `[cert-fs]` lines for CI/operator visibility. */
  log?: boolean;
  /** Prefix label in log lines (default: "OUT_DIR"). */
  label?: string;
};

function classifyPath(target: string): PathInspection {
  if (!existsSync(target)) {
    return { path: target, exists: false, kind: "missing" };
  }
  try {
    const st = lstatSync(target);
    if (st.isDirectory()) return { path: target, exists: true, kind: "directory" };
    if (st.isFile()) return { path: target, exists: true, kind: "file" };
    return { path: target, exists: true, kind: "other" };
  } catch {
    return { path: target, exists: false, kind: "missing" };
  }
}

function logEnsureStep(label: string, message: string): void {
  console.log(`[cert-fs] ${label}: ${message}`);
}

/**
 * Ensure `dir` exists as a directory. Safe for unlimited repeated runs and CI.
 */
export async function ensureDir(dir: string, options: EnsureDirOptions = {}): Promise<EnsureDirResult> {
  const label = options.label ?? "OUT_DIR";
  const before = classifyPath(dir);

  if (options.log) {
    logEnsureStep(label, `path=${dir}`);
    logEnsureStep(label, `existsSync=${before.exists} kind=${before.kind}`);
  }

  if (before.kind === "directory") {
    if (options.log) logEnsureStep(label, "mkdir skipped (already directory)");
    return { path: dir, existedBefore: true, kindBefore: before.kind, action: "already_directory" };
  }

  if (before.kind === "file") {
    if (options.log) logEnsureStep(label, "removing file blocking directory path");
    await unlink(dir);
  } else if (before.kind === "other") {
    throw new Error(`${label} path exists but is neither file nor directory: ${dir}`);
  }

  try {
    await mkdir(dir, { recursive: true });
    if (options.log) logEnsureStep(label, "mkdir result=created");
    return { path: dir, existedBefore: before.exists, kindBefore: before.kind, action: "created" };
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === "EEXIST") {
      const after = classifyPath(dir);
      if (after.kind === "directory") {
        if (options.log) logEnsureStep(label, "mkdir result=EEXIST treated as success (directory)");
        return { path: dir, existedBefore: before.exists, kindBefore: before.kind, action: "already_directory" };
      }
      if (options.log) logEnsureStep(label, `mkdir result=EEXIST kind=${after.kind} (not a directory)`);
    } else if (options.log) {
      logEnsureStep(label, `mkdir result=error code=${code ?? "unknown"}`);
    }
    throw err;
  }
}

/** Remove evidence files older than maxAgeMs (default 7 days). */
export async function pruneStaleEvidence(
  dir: string,
  maxAgeMs = 7 * 24 * 60 * 60 * 1000,
): Promise<number> {
  let removed = 0;
  try {
    const names = await readdir(dir);
    const cutoff = Date.now() - maxAgeMs;
    for (const name of names) {
      const path = join(dir, name);
      const st = await stat(path).catch(() => null);
      if (!st) continue;
      if (st.mtimeMs < cutoff) {
        if (st.isDirectory()) await rm(path, { recursive: true, force: true });
        else await unlink(path);
        removed++;
      }
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
    throw err;
  }
  return removed;
}
