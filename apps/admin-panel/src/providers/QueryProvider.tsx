"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";
import { AdminApiError } from "@/lib/api-error";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            gcTime: 5 * 60_000,
            networkMode: "online",
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
            retry: (failureCount, error) => {
              // Don't retry 4xx auth/forbidden — surface immediately
              if (error instanceof AdminApiError) {
                if (error.status === 401 || error.status === 403 || error.status === 404) {
                  return false;
                }
              }
              return failureCount < 2;
            },
          },
          mutations: {
            retry: 1,
            networkMode: "online",
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
