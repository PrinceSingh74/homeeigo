/**
 * Single shared NetInfo subscription — feeds Zustand, React Query onlineManager,
 * RUM network labels, offline queue replay, and realtime reconnect hooks.
 */
import { create } from "zustand";
import { AppState, type AppStateStatus } from "react-native";
import NetInfo, { type NetInfoState } from "@react-native-community/netinfo";
import { focusManager, onlineManager } from "@tanstack/react-query";
import { setNetworkLabel } from "@/lib/observability/telemetry";

export type NetworkLabel = "4g" | "3g" | "2g" | "slow-2g" | "offline" | "unknown";

export type ConnectivitySnapshot = {
  isConnected: boolean;
  isInternetReachable: boolean | null;
  type: string;
  networkLabel: NetworkLabel;
  subscriptionActive: boolean;
};

function labelFor(state: NetInfoState): NetworkLabel {
  if (state.isConnected === false) return "offline";
  const effective = (state.details as { cellularGeneration?: string } | null)?.cellularGeneration;
  if (effective === "4g" || effective === "5g") return "4g";
  if (effective === "3g") return "3g";
  if (effective === "2g") return "2g";
  if (state.type === "wifi") return "4g";
  return "unknown";
}

const reconnectListeners = new Set<() => void>();
let netInfoUnsubscribe: (() => void) | null = null;
let lastConnected = true;
let reactQueryBridgeInstalled = false;

export const useConnectivityStore = create<ConnectivitySnapshot>(() => ({
  isConnected: true,
  isInternetReachable: null,
  type: "unknown",
  networkLabel: "unknown",
  subscriptionActive: false,
}));

function applyNetInfoState(state: NetInfoState): void {
  const isConnected = state.isConnected ?? false;
  const networkLabel = labelFor(state);
  const wasDisconnected = !lastConnected;
  lastConnected = isConnected;

  setNetworkLabel(networkLabel);
  onlineManager.setOnline(isConnected);

  useConnectivityStore.setState({
    isConnected,
    isInternetReachable: state.isInternetReachable ?? null,
    type: state.type,
    networkLabel,
  });

  if (isConnected && wasDisconnected) {
    for (const listener of reconnectListeners) listener();
  }
}

/** Register a callback fired when connectivity transitions offline → online. */
export function onConnectivityReconnect(listener: () => void): () => void {
  reconnectListeners.add(listener);
  return () => reconnectListeners.delete(listener);
}

/** Start the single global NetInfo listener. Idempotent. */
export function startConnectivityService(): void {
  if (netInfoUnsubscribe) return;

  netInfoUnsubscribe = NetInfo.addEventListener(applyNetInfoState);
  useConnectivityStore.setState({ subscriptionActive: true });
  void NetInfo.fetch().then(applyNetInfoState);

  if (!reactQueryBridgeInstalled) {
    reactQueryBridgeInstalled = true;
    onlineManager.setEventListener((setOnline) => {
      setOnline(useConnectivityStore.getState().isConnected);
      return useConnectivityStore.subscribe((snap) => setOnline(snap.isConnected));
    });

    // React Query has no notion of "app backgrounded" on React Native — without
    // this bridge every polling query keeps firing while the app is in the
    // background. The bookings query polls every 8s whenever a booking is active,
    // which was by far the busiest request in a captured session. Marking the app
    // unfocused pauses interval refetching and resumes it on return; foreground
    // behaviour is unchanged.
    focusManager.setEventListener((setFocused) => {
      const sub = AppState.addEventListener("change", (state: AppStateStatus) => {
        setFocused(state === "active");
      });
      setFocused(AppState.currentState === "active");
      return () => sub.remove();
    });
  }
}

/** Verification helper — must be exactly 0 or 1 after service start. */
export function getActiveNetInfoSubscriptionCount(): number {
  return netInfoUnsubscribe ? 1 : 0;
}

/** Test-only reset. */
export function resetConnectivityServiceForTests(): void {
  netInfoUnsubscribe?.();
  netInfoUnsubscribe = null;
  reconnectListeners.clear();
  reactQueryBridgeInstalled = false;
  useConnectivityStore.setState({
    isConnected: true,
    isInternetReachable: null,
    type: "unknown",
    networkLabel: "unknown",
    subscriptionActive: false,
  });
}
