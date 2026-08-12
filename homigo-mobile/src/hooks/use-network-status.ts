import { useConnectivityStore } from "@/lib/connectivity/connectivity-service";

export type NetworkStatus = { online: boolean; type: string };

/** @deprecated Use startConnectivityService() from connectivity-service — kept for import compat. */
export { startConnectivityService as startNetworkMonitor } from "@/lib/connectivity/connectivity-service";

/** React hook — reads from the shared connectivity Zustand store (no extra NetInfo listener). */
export function useNetworkStatus(): NetworkStatus {
  const isConnected = useConnectivityStore((s) => s.isConnected);
  const type = useConnectivityStore((s) => s.type);
  return { online: isConnected, type };
}
