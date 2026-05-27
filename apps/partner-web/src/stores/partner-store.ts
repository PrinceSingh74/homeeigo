"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  DEMO_REQUESTS,
  DEMO_VENDOR,
  type BookingRequest,
} from "@/lib/partner-data";

type PartnerState = {
  authenticated: boolean;
  vendor: typeof DEMO_VENDOR;
  requests: BookingRequest[];
  activeJobId: string | null;
  setAuthenticated: (v: boolean) => void;
  setOnline: (online: boolean) => void;
  acceptRequest: (id: string) => void;
  rejectRequest: (id: string) => void;
  setActiveJob: (id: string | null) => void;
};

export const usePartnerStore = create<PartnerState>()(
  persist(
    (set, get) => ({
      authenticated: false,
      vendor: DEMO_VENDOR,
      requests: DEMO_REQUESTS,
      activeJobId: null,
      setAuthenticated: (authenticated) => set({ authenticated }),
      setOnline: (online) =>
        set((s) => ({ vendor: { ...s.vendor, online } })),
      acceptRequest: (id) => {
        const req = get().requests.find((r) => r.id === id);
        set((s) => ({
          requests: s.requests.filter((r) => r.id !== id),
          activeJobId: id,
        }));
        return req;
      },
      rejectRequest: (id) =>
        set((s) => ({
          requests: s.requests.filter((r) => r.id !== id),
        })),
      setActiveJob: (activeJobId) => set({ activeJobId }),
    }),
    { name: "homigo-partner-store", partialize: (s) => ({
      authenticated: s.authenticated,
      vendor: s.vendor,
    }) }
  )
);
