import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { AppState } from "react-native";
import {
  refreshBackgroundPermission,
  startBackgroundLocation,
  stopBackgroundLocation,
  type BackgroundMode,
} from "@/lib/background-location";
import { BOOKING_LIST_FILTER, bookingStatusRank } from "@/lib/booking-status";
import { PRESENCE_CADENCE, resolveAvailability } from "@/hooks/use-partner-presence-heartbeat";
import { partnerApi } from "@/services/partner-api";
import { useAuthStore } from "@/stores/auth-store";

/**
 * Decides WHEN background location runs. Mount once at the app root.
 *
 * Runs only while the partner is signed in AND (on an active job OR online in a state whose presence
 * cadence collects GPS — i.e. not OFFLINE and not PAUSED). Never prompts: without "Always" /
 * "Allow all the time" permission it stays off and `useBackgroundLocationStatus` reports why, so
 * the UI can explain that presence will go stale in the background.
 */
export function useBackgroundLocationController() {
  const isAuthenticated = useAuthStore((s) => s.hydrated && !!s.user && !!s.accessToken);

  // Same key the presence heartbeat and online card use — one request, shared cache.
  const ops = useQuery({
    queryKey: ["partner", "operations"],
    queryFn: () => partnerApi.operations(),
    enabled: isAuthenticated,
  });
  const activeWork = useQuery({
    queryKey: ["partner", "bookings", "background-active"],
    queryFn: () =>
      partnerApi.listBookings({ status: BOOKING_LIST_FILTER.ACTIVE_WORK, limit: 10, sortBy: "upcoming" }),
    enabled: isAuthenticated,
    // Realtime booking events invalidate ["partner","bookings"]; this is the fallback.
    refetchInterval: isAuthenticated ? 60_000 : false,
  });

  // The most advanced active job is the one being travelled to / worked on.
  const activeJobId = useMemo(() => {
    const rows = activeWork.data?.bookings ?? [];
    if (rows.length === 0) return null;
    return [...rows].sort((a, b) => bookingStatusRank(b.status) - bookingStatusRank(a.status))[0]?.id ?? null;
  }, [activeWork.data]);

  const availability = resolveAvailability(ops.data);
  const wantsGps = PRESENCE_CADENCE[availability].locationEveryN != null;
  const mode: BackgroundMode | null = !isAuthenticated
    ? null
    : activeJobId
      ? "active_job"
      : wantsGps
        ? "idle"
        : null;
  // Do not stop on a transient fetch failure — only on a known "should not run".
  const known = ops.data !== undefined || activeWork.data !== undefined;

  useEffect(() => {
    if (!isAuthenticated) {
      void stopBackgroundLocation();
      return;
    }
    if (!known) return;
    if (mode) void startBackgroundLocation(mode, activeJobId);
    else void stopBackgroundLocation();
  }, [isAuthenticated, known, mode, activeJobId]);

  // Permission can be changed in Settings while the app is away — re-read it on return and retry.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") return;
      void refreshBackgroundPermission().then((p) => {
        if (p === "granted" && mode) void startBackgroundLocation(mode, activeJobId);
      });
    });
    return () => sub.remove();
  }, [mode, activeJobId]);
}
