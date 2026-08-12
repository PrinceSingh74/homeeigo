import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { onOfflineReplaySuccess } from "@/lib/offline/sender";
import { reportRecoverySignal } from "@/lib/observability/telemetry";
import { qk } from "@/hooks/use-core-data";

/** Invalidates React Query caches after offline replays so UI reflects server state. */
export function OfflineSyncBridge(): null {
  const qc = useQueryClient();

  useEffect(() => {
    return onOfflineReplaySuccess((path) => {
      reportRecoverySignal("cache_invalidation", 1);
      if (path.includes("/bookings")) void qc.invalidateQueries({ queryKey: qk.bookings });
      if (path.includes("/addresses") || path.includes("/users/addresses")) {
        void qc.invalidateQueries({ queryKey: qk.addresses });
      }
      if (path.includes("/ratings")) {
        void qc.invalidateQueries({ queryKey: qk.ratings });
        void qc.invalidateQueries({ queryKey: qk.bookings });
      }
      if (path.includes("/notifications")) {
        void qc.invalidateQueries({ queryKey: qk.notifications });
      }
      if (path.includes("/users/me")) void qc.invalidateQueries({ queryKey: ["users", "me"] });
      if (path.includes("/support")) void qc.invalidateQueries({ queryKey: ["support"] });
    });
  }, [qc]);

  return null;
}
