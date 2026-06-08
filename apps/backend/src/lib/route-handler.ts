export function handleRoute<T>(fn: () => Promise<T> | T): Promise<T | { success: false; error: string; code: string }> {
  return Promise.resolve()
    .then(fn)
    .catch((err: Error) => {
      if (err.message === "UNAUTHORIZED") {
        return { success: false as const, error: "Invalid or expired token", code: "UNAUTHORIZED" };
      }
      if (err.message === "FORBIDDEN") {
        return { success: false as const, error: "You don't have permission", code: "FORBIDDEN" };
      }
      throw err;
    });
}
