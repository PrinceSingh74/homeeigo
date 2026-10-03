"use client";

import { usePartnerPresenceHeartbeat } from "@/hooks/use-partner-presence-heartbeat";

/**
 * App-wide presence heartbeat. Mounted once next to `PartnerRealtimeBridge`
 * so dispatch liveness is maintained on every partner screen.
 */
export function PartnerPresenceHeartbeat() {
  usePartnerPresenceHeartbeat();
  return null;
}
