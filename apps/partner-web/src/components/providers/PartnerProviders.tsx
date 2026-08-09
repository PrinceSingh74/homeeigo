"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { PartnerApiError } from "@/lib/api-error";
import { usePartnerStore } from "@/stores/partner-store";
import { ThemeProvider } from "@/components/theme/ThemeProvider";

function PartnerAuthBootstrap({ children }: { children: React.ReactNode }) {
  const bootstrap = usePartnerStore((s) => s.bootstrap);
  const status = usePartnerStore((s) => s.status);

  useEffect(() => {
    if (status === "idle") void bootstrap();
  }, [bootstrap, status]);

  return <>{children}</>;
}

export function PartnerProviders({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 20_000,
            gcTime: 5 * 60_000,
            refetchOnWindowFocus: false,
            refetchOnReconnect: true,
            networkMode: "online",
            retry: (failureCount, error) => {
              if (error instanceof PartnerApiError) {
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

  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <PartnerAuthBootstrap>{children}</PartnerAuthBootstrap>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
