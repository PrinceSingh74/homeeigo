/**
 * RNTL wrapper that mounts components inside the providers the real app supplies.
 *
 * Component suites render leaf components in isolation, but several of them reach hooks that
 * require app-level context — `AiChatBlock` calls `useActiveTracking`, which calls
 * `useQueryClient()` and throws "No QueryClient set" without a provider. Rather than every test
 * remembering to wrap, this module re-exports the whole RNTL surface with a `render` that supplies
 * the providers, and Jest's `moduleNameMapper` points `@testing-library/react-native` here.
 *
 * A fresh QueryClient per render keeps suites isolated (no cache bleed between tests), and retries
 * are disabled so a deliberately-failing query surfaces immediately instead of after backoff.
 */
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  render as rntlRender,
  type RenderOptions,
} from "@testing-library/react-native";

export * from "@testing-library/react-native";

function makeTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export function AllProviders({ children }: { children: React.ReactNode }): React.ReactElement {
  const client = makeTestQueryClient();
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

/** Drop-in replacement for RNTL's `render`, with app providers applied. */
export function render(ui: React.ReactElement, options?: RenderOptions) {
  return rntlRender(ui, { wrapper: AllProviders, ...options });
}
