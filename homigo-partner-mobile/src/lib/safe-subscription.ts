/**
 * Stopping a watch must never be the thing that breaks a screen.
 *
 * `remove()` on a location subscription runs inside effect clean-ups and timers — when a job
 * leaves its active stage, when a screen unmounts. If it throws there (it does on the web build,
 * where the platform's emitter has no `removeSubscription`), the error lands in the render path
 * and the whole screen is replaced by the error boundary at exactly the moment a job was closed.
 * A failed stop is logged-and-forgotten: the watch is being abandoned either way.
 */
export function removeQuietly(sub: { remove(): void } | null | undefined): void {
  if (!sub) return;
  try {
    sub.remove();
  } catch {
    /* nothing to do: the subscription is being dropped */
  }
}

/** The same subscription, with a `remove()` that cannot throw. */
export function quietSubscription<T extends { remove(): void }>(sub: T): { remove(): void } {
  return { remove: () => removeQuietly(sub) };
}
