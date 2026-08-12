"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { LocationId } from "@/lib/services";
import { LOCATIONS } from "@/lib/services";
import type { BookingStatus, SavedBooking } from "@/lib/bookings";
import { dedupeBookingsById, patchTimeline } from "@/lib/bookings";

export type Toast = {
  id: string;
  message: string;
  type?: "success" | "info" | "error";
};

type Overlay =
  | "location"
  | "notifications"
  | "profile"
  | "ai"
  | "how-it-works"
  | "quick-filters"
  | "premium"
  | "wallet"
  | "support"
  | "settings"
  | "services-categories"
  | "services-trending"
  | "services-ai"
  | "services-reviews"
  | null;

type AppState = {
  locationId: LocationId;
  overlay: Overlay;
  activePromo: string | null;
  toasts: Toast[];
  bookings: SavedBooking[];
  isPremium: boolean;
  supportCallbackQueued: boolean;
  setLocationId: (id: LocationId) => void;
  openOverlay: (o: Overlay) => void;
  closeOverlay: () => void;
  setActivePromo: (code: string | null) => void;
  setPremium: (value: boolean) => void;
  requestSupportCallback: () => void;
  addBooking: (booking: SavedBooking) => void;
  /** Reconcile the local store with the authoritative server list (prunes stale bookings). */
  syncServerBookings: (serverBookings: SavedBooking[]) => void;
  updateBookingStatus: (id: string, status: BookingStatus) => void;
  getBookingById: (id: string) => SavedBooking | undefined;
  showToast: (message: string, type?: Toast["type"]) => void;
  dismissToast: (id: string) => void;
};

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      locationId: LOCATIONS[0].id,
      overlay: null,
      activePromo: null,
      toasts: [],
      bookings: [],
      isPremium: false,
      supportCallbackQueued: false,

      setLocationId: (id) => {
        set({ locationId: id });
        const loc = LOCATIONS.find((l) => l.id === id);
        get().showToast(`Location updated to ${loc?.label ?? "your area"}`, "success");
      },
      openOverlay: (o) => set({ overlay: o }),
      closeOverlay: () => set({ overlay: null }),
      setActivePromo: (code) => set({ activePromo: code }),

      setPremium: (value) => {
        set({ isPremium: value });
        if (value) get().showToast("Welcome to HOMEEIGO Premium! 🎉", "success");
      },

      requestSupportCallback: () => {
        set({ supportCallbackQueued: true });
        get().showToast("A HOMEEIGO specialist will call you within 5 minutes", "success");
      },

      addBooking: (booking) =>
        set((s) => {
          const rest = s.bookings.filter((b) => b.id !== booking.id);
          return { bookings: dedupeBookingsById([booking, ...rest]) };
        }),

      // The backend is the source of truth: keep exactly what it returns so
      // stale bookings persisted from a previous session/reseed are dropped
      // (prevents "Booking not found" when opening a dead local booking).
      syncServerBookings: (serverBookings) =>
        set(() => ({ bookings: dedupeBookingsById(serverBookings) })),

      updateBookingStatus: (id, status) => {
        const now = new Date().toISOString();
        set((s) => ({
          bookings: s.bookings.map((b) => {
            if (b.id !== id) return b;
            return {
              ...b,
              status,
              updatedAt: now,
              cancelledAt: status === "cancelled" ? now : b.cancelledAt,
              completedAt: status === "completed" ? now : b.completedAt,
              timeline: patchTimeline(b.timeline, status, now),
            };
          }),
        }));
      },

      getBookingById: (id) => get().bookings.find((b) => b.id === id),

      showToast: (message, type = "info") => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        let added = false;
        set((s) => {
          const duplicate = s.toasts.some(
            (t) => t.message === message && t.type === type,
          );
          if (duplicate) return s;
          added = true;
          const next = [...s.toasts, { id, message, type }];
          return { toasts: next.length > 5 ? next.slice(-5) : next };
        });
        if (added) setTimeout(() => get().dismissToast(id), 3200);
      },
      dismissToast: (id) =>
        set((s) => {
          if (!s.toasts.some((t) => t.id === id)) return s;
          return { toasts: s.toasts.filter((t) => t.id !== id) };
        }),
    }),
    {
      name: "homigo-web-v1",
      merge: (persisted, current) => {
        const p = persisted as Partial<AppState> | undefined;
        return {
          ...current,
          ...p,
          bookings: dedupeBookingsById(p?.bookings ?? current.bookings),
        };
      },
      partialize: (s) => ({
        locationId: s.locationId,
        activePromo: s.activePromo,
        bookings: dedupeBookingsById(s.bookings),
        isPremium: s.isPremium,
        supportCallbackQueued: s.supportCallbackQueued,
      }),
    },
  ),
);
