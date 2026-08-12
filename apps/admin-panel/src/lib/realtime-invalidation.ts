import type { QueryClient } from "@tanstack/react-query";

/** Debounced invalidation — collapses WS burst events into one refetch wave. */
const pending = new Map<string, ReturnType<typeof setTimeout>>();

export function debouncedInvalidate(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  delayMs = 750,
): void {
  const key = JSON.stringify(queryKey);
  const existing = pending.get(key);
  if (existing) clearTimeout(existing);
  pending.set(
    key,
    setTimeout(() => {
      pending.delete(key);
      void queryClient.invalidateQueries({ queryKey });
    }, delayMs),
  );
}
