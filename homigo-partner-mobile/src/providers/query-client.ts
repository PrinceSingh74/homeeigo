import { QueryClient } from "@tanstack/react-query";

/**
 * The app's single QueryClient, in its own module so non-React code (auth teardown, the realtime
 * bridge) can reach it without importing the provider component.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});
