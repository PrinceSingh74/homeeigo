import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

const MAX_RETRIES = 2;

/**
 * A 4xx is the server's settled answer — "not found", "forbidden", "bad request"
 * do not become 200 by asking again, so retrying them only multiplies traffic. In
 * one captured session `/api/tracking/<id>` produced 170 requests that were all
 * 404, because each miss was retried three times. Timeouts (408) and rate limits
 * (429) are the exceptions: those are worth another attempt.
 *
 * 5xx and network failures keep the original retry budget.
 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (failureCount >= MAX_RETRIES) return false;
  const status = (error as { status?: number } | null)?.status;
  if (typeof status === "number" && status >= 400 && status < 500) {
    return status === 408 || status === 429;
  }
  return true;
}

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            retry: shouldRetry,
            networkMode: "offlineFirst",
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
          },
          mutations: {
            // Mutations keep a single retry, but a 4xx (validation, conflict,
            // already-paid) must never be replayed — a retried POST can duplicate
            // a booking or a payment.
            retry: (failureCount, error) => failureCount < 1 && shouldRetry(failureCount, error),
            networkMode: "offlineFirst",
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
