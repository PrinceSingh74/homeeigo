"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { AuthApiError } from "@/lib/auth/errors";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            retry: 2,
            networkMode: "offlineFirst",
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
          },
          mutations: {
            // Replay only when the request never got an HTTP answer (status 0 = unreachable).
            // A 4xx/5xx is final: a retried booking or payment POST can duplicate it. Same policy
            // as the customer mobile app.
            retry: (failureCount, error) =>
              failureCount < 1 && (!(error instanceof AuthApiError) || error.status === 0),
            networkMode: "offlineFirst",
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
