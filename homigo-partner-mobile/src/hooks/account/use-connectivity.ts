import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { AppState } from "react-native";
import { create } from "zustand";
import { CONNECTED, nextConnectivity, outcomeOf, type ConnectivityState } from "@/lib/connectivity";

/**
 * "Can the app reach HOMEEIGO right now?" — for the offline banner.
 *
 * Checked on 2026-10-07 against @tanstack/query-core `onlineManager`: it only listens to
 * `window.addEventListener("online" | "offline")`, which React Native does not have ("addEventListener
 * does not exist in React Native, but window does" — its own comment), so without NetInfo it reports
 * online forever. This app has no NetInfo package. The state here is therefore derived from what
 * the app's own requests experienced: every query and mutation that settles is read by
 * `lib/connectivity` — no HTTP answer means offline, any HTTP answer means online.
 *
 * `onlineManager` is deliberately NOT told about it: marking it offline pauses every query, and a
 * paused query never makes the request that would show the connection is back.
 */
const useConnectivityStore = create<ConnectivityState>(() => CONNECTED);

function record(error: unknown) {
  const prev = useConnectivityStore.getState();
  const next = nextConnectivity(prev, outcomeOf(error), Date.now());
  if (next !== prev) useConnectivityStore.setState(next, true);
}

/** While offline, how often the screens' failed reads are asked again so the banner clears by itself. */
const RETRY_MS = 15_000;

/** Mount ONCE, inside the QueryClientProvider. */
export function useConnectivityWatcher(): void {
  const qc = useQueryClient();
  const offline = useConnectivityStore((s) => s.offline);

  useEffect(() => {
    const unsubQueries = qc.getQueryCache().subscribe((event) => {
      if (event.type !== "updated") return;
      if (event.action.type === "success") record(null);
      else if (event.action.type === "error") record(event.action.error);
    });
    const unsubMutations = qc.getMutationCache().subscribe((event) => {
      if (event.type !== "updated") return;
      if (event.action.type === "success") record(null);
      else if (event.action.type === "error") record(event.action.error);
    });
    return () => {
      unsubQueries();
      unsubMutations();
    };
  }, [qc]);

  useEffect(() => {
    if (!offline) return;
    const retry = () => {
      if (AppState.currentState !== "active") return;
      void qc.refetchQueries({ type: "active", predicate: (q) => q.state.status === "error" || q.state.fetchStatus === "idle" });
    };
    const id = setInterval(retry, RETRY_MS);
    const sub = AppState.addEventListener("change", (s) => {
      if (s === "active") retry();
    });
    return () => {
      clearInterval(id);
      sub.remove();
    };
  }, [offline, qc]);
}

export function useIsOffline(): boolean {
  return useConnectivityStore((s) => s.offline);
}

/** Ask every visible read again now (the banner's "Try again"). */
export function useRetryConnection(): () => void {
  const qc = useQueryClient();
  return () => void qc.refetchQueries({ type: "active" });
}
