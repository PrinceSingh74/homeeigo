"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { PartnerApiError } from "@/lib/api-error";
import { usePartnerStore } from "@/stores/partner-store";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { MotionProvider } from "@/components/providers/MotionProvider";

function PartnerAuthBootstrap({ children }: { children: React.ReactNode }) {
  const bootstrap = usePartnerStore((s) => s.bootstrap);

  useEffect(() => {
    const start = () => {
      if (usePartnerStore.getState().status === "idle") void bootstrap();
    };
    const persistApi = usePartnerStore.persist;
    // Subscribe first. Hydration can finish between a prior check and this subscription, and
    // then the listener never fires: status stays "idle" and PartnerAuthGuard spins forever.
    const unsub = persistApi.onFinishHydration(start);
    if (persistApi.hasHydrated()) start();
    else void persistApi.rehydrate();
    return unsub;
  }, [bootstrap]);

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
            // Replay only when no HTTP response arrived (network failure). Any server answer —
            // 4xx (conflict, validation, already accepted) or 5xx — is final: a replayed job action
            // can double-apply. Same policy as the customer mobile app.
            retry: (failureCount, error) => failureCount < 1 && !(error instanceof PartnerApiError),
            networkMode: "online",
          },
        },
      }),
  );

  return (
    <QueryClientProvider client={client}>
      <ThemeProvider>
        <MotionProvider>
          <PartnerAuthBootstrap>{children}</PartnerAuthBootstrap>
        </MotionProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
