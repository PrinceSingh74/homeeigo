/** Normalize unknown throws (incl. browser Event from script/chunk errors) for UI. */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  if (typeof error === "string") return error;

  if (error && typeof error === "object") {
    const e = error as Event & { message?: string; reason?: unknown };
    if (typeof e.message === "string" && e.message) return e.message;
    if ("reason" in e && e.reason) return getErrorMessage(e.reason);
  }

  return "Something went wrong. Please refresh and try again.";
}

/** True only for webpack/Next chunk load failures — avoid reloading on any script error. */
export function isChunkLoadError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  const name = error.name.toLowerCase();
  return (
    name.includes("chunkloaderror") ||
    msg.includes("loading chunk") ||
    msg.includes("chunk load") ||
    msg.includes("failed to import") ||
    msg.includes("dynamically imported module") ||
    msg.includes("importing a module script failed") ||
    (msg.includes("chunk") && msg.includes("failed"))
  );
}
