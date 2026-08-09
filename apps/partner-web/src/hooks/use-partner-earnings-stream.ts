"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { resolveWsBase } from "@/lib/api-client";
import { useRealtimeChannel } from "@/hooks/use-realtime-channel";
import { partnerKeys } from "@/hooks/use-partner-data";
import { usePartnerStore } from "@/stores/partner-store";

export type EarningsLiveSnapshot = {
  totalEarnings: number;
  todayEarnings: number;
  weeklyEarnings: number;
  monthlyEarnings: number;
  completedBookings: number;
  walletBalance: number;
  pendingAmount: number;
};

type Options = {
  enabled?: boolean;
};

/**
 * Subscribes to /ws/earnings/:providerId for live wallet + earnings tiles.
 *
 * Backend route (apps/backend/src/websocket/earnings.ws.ts) uses the authenticated
 * userId as the ":providerId" param — we pass `user.id` from the partner store to match.
 *
 * Pushed messages of type EARNINGS_UPDATE update local state and invalidate wallet/dashboard
 * caches so any pre-existing UI keeps working unchanged.
 */
export function usePartnerEarningsStream({ enabled = true }: Options = {}) {
  const qc = useQueryClient();
  const token = usePartnerStore((s) => s.accessToken);
  const userId = usePartnerStore((s) => s.user?.id ?? null);
  const wsBase = resolveWsBase();

  const url = useMemo(() => {
    if (!enabled || !token || !userId) return null;
    return `${wsBase}/ws/earnings/${encodeURIComponent(userId)}?token=${encodeURIComponent(token)}`;
  }, [enabled, token, userId, wsBase]);

  const [snapshot, setSnapshot] = useState<EarningsLiveSnapshot | null>(null);
  const lastEventTsRef = useRef(0);
  const processedRef = useRef<Set<string>>(new Set());

  const ws = useRealtimeChannel({
    url,
    enabled: !!url,
    onMessage: (event) => {
      try {
        const msg = JSON.parse(event.data ?? "{}") as {
          type?: string;
          timestamp?: string;
          data?: Partial<EarningsLiveSnapshot> & { eventId?: string };
        };

        const tsStr = msg.timestamp ?? "";
        const tsNum = Date.parse(tsStr);
        if (!Number.isNaN(tsNum) && tsNum < lastEventTsRef.current) return;

        const dedupeKey =
          msg.data?.eventId ?? `${msg.type ?? ""}:${tsStr || Date.now()}`;
        if (processedRef.current.has(dedupeKey)) return;
        processedRef.current.add(dedupeKey);
        if (processedRef.current.size > 200) {
          const first = processedRef.current.values().next().value as
            | string
            | undefined;
          if (first) processedRef.current.delete(first);
        }

        if (!Number.isNaN(tsNum)) lastEventTsRef.current = tsNum;

        if (msg.type === "EARNINGS_UPDATE" && msg.data) {
          const next: EarningsLiveSnapshot = {
            totalEarnings: Number(msg.data.totalEarnings ?? 0),
            todayEarnings: Number(msg.data.todayEarnings ?? 0),
            weeklyEarnings: Number(msg.data.weeklyEarnings ?? 0),
            monthlyEarnings: Number(msg.data.monthlyEarnings ?? 0),
            completedBookings: Number(msg.data.completedBookings ?? 0),
            walletBalance: Number(msg.data.walletBalance ?? 0),
            pendingAmount: Number(msg.data.pendingAmount ?? 0),
          };
          setSnapshot(next);

          // Keep React Query cache fresh so existing pages relying on REST stay in sync.
          void qc.invalidateQueries({ queryKey: partnerKeys.walletBalance });
          void qc.invalidateQueries({ queryKey: partnerKeys.dashboard });
        }

        if (msg.type === "WITHDRAWAL_INITIATED") {
          void qc.invalidateQueries({ queryKey: partnerKeys.walletTxAll });
          void qc.invalidateQueries({ queryKey: partnerKeys.walletBalance });
        }
      } catch {
        // ignore malformed payloads
      }
    },
  });

  useEffect(() => {
    if (ws.connected) {
      // Refresh REST-backed views when stream (re)connects after offline.
      void qc.invalidateQueries({ queryKey: partnerKeys.walletBalance });
      void qc.invalidateQueries({ queryKey: partnerKeys.dashboard });
    }
  }, [qc, ws.connected]);

  return {
    snapshot,
    connected: ws.connected,
    reconnecting: ws.reconnecting,
    offline: ws.offline,
  };
}
