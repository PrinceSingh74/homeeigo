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
  unreadNotifications: number;
  supportCallbackQueued: boolean;
  setLocationId: (id: LocationId) => void;
  openOverlay: (o: Overlay) => void;
  closeOverlay: () => void;
  setActivePromo: (code: string | null) => void;
  setPremium: (value: boolean) => void;
  markNotificationsRead: () => void;
  requestSupportCallback: () => void;
  addBooking: (booking: SavedBooking) => void;
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
      unreadNotifications: 3,
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
        if (value) get().showToast("Welcome to HOMIGO Premium! 🎉", "success");
      },

      markNotificationsRead: () => set({ unreadNotifications: 0 }),

      requestSupportCallback: () => {
        set({ supportCallbackQueued: true });
        get().showToast("A HOMIGO specialist will call you within 5 minutes", "success");
      },

      addBooking: (booking) =>
        set((s) => {
          const rest = s.bookings.filter((b) => b.id !== booking.id);
          return { bookings: dedupeBookingsById([booking, ...rest]) };
        }),

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
        set((s) => ({ toasts: [...s.toasts, { id, message, type }] }));
        setTimeout(() => get().dismissToast(id), 3200);
      },
      dismissToast: (id) =>
        set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
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
        unreadNotifications: s.unreadNotifications,
        supportCallbackQueued: s.supportCallbackQueued,
      }),
    },
  ),
);
