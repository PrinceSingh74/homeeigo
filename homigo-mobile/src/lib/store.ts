import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { LocationId } from "./services";
import { LOCATIONS } from "./services";

export type BookingStatus =
  | "confirmed"
  | "in_progress"
  | "completed"
  | "cancelled";

export type TimelineEvent = {
  id: string;
  label: string;
  at: string;
  done: boolean;
};

export type SavedBooking = {
  id: string;
  serviceId: string;
  serviceTitle: string;
  serviceName: string;
  packageName: string;
  dateLabel: string;
  timeLabel: string;
  address: string;
  total: number;
  /** Catalog snapshot of purchased add-ons ({id,name,price}) from the backend. */
  addons?: { id: string; name: string; price: number }[];
  status: BookingStatus;
  createdAt: string;
  updatedAt: string;
  cancelledAt?: string;
  completedAt?: string;
  imageKey?: string;
  serviceColor: string;
  proName: string;
  instructions?: string;
  paymentStatus?: string;
  /** Raw backend status — live-tracking must pick the booking a partner is actually riding for. */
  backendStatus?: string;
  timeline: TimelineEvent[];
};

export function collapseCustomerBookingStatus(raw: string | undefined): BookingStatus {
  const v = (raw ?? "").toLowerCase().replace(/-/g, "_");
  if (v === "completed") return "completed";
  if (v === "in_progress" || v === "en_route") return "in_progress";
  if (v === "rejected" || v === "cancelled" || v.includes("cancel")) return "cancelled";
  return "confirmed";
}

export function customerTimelineFromBackendStatus(
  raw: string | undefined,
  now = new Date().toISOString(),
): TimelineEvent[] {
  const ui = collapseCustomerBookingStatus(raw);
  const v = (raw ?? "").toLowerCase().replace(/-/g, "_");
  if (ui === "cancelled") {
    return [
      { id: "1", label: "Booking confirmed", at: now, done: true },
      { id: "cancel", label: "Booking cancelled", at: now, done: true },
    ];
  }
  const assigned = ["accepted", "assigned", "en_route", "in_progress", "completed"].includes(v);
  const onTheWay = v === "en_route" || v === "in_progress" || v === "completed";
  const completed = v === "completed";
  return [
    { id: "1", label: "Booking confirmed", at: now, done: true },
    { id: "2", label: "Pro assigned", at: assigned ? now : "", done: assigned },
    { id: "3", label: "On the way", at: onTheWay ? now : "", done: onTheWay },
    { id: "4", label: "Service completed", at: completed ? now : "", done: completed },
  ];
}

export function createInitialTimeline(now = new Date().toISOString()): TimelineEvent[] {
  return customerTimelineFromBackendStatus("pending", now);
}

function patchTimeline(
  timeline: TimelineEvent[],
  status: BookingStatus,
  now: string,
): TimelineEvent[] {
  const t = timeline.map((e) => ({ ...e }));
  if (status === "confirmed") return t;
  if (status === "in_progress") {
    t[1] = { ...t[1], done: true, at: t[1].at || now };
    t[2] = { ...t[2], done: true, at: t[2].at || now };
    return t;
  }
  if (status === "completed") {
    return t.map((e, i) => ({
      ...e,
      done: true,
      at: e.at || (i === 0 ? now : now),
    }));
  }
  if (status === "cancelled") {
    return [
      ...t.slice(0, 1),
      {
        id: "cancel",
        label: "Booking cancelled",
        at: now,
        done: true,
      },
    ];
  }
  return t;
}

export type AppOverlay =
  | "location"
  | "notifications"
  | "premium"
  | "categories"
  | "trending"
  | "ai-recommendations"
  | "reviews"
  | "settings"
  | "addresses"
  | "transactions"
  | "referral"
  | "add-money"
  | null;

interface AppState {
  isDarkMode: boolean;
  toggleDarkMode: () => void;
  locationId: LocationId;
  setLocationId: (id: LocationId) => void;
  activePromo: string | null;
  setActivePromo: (code: string | null) => void;
  overlay: AppOverlay;
  openOverlay: (o: AppOverlay) => void;
  closeOverlay: () => void;
  isPremium: boolean;
  setPremium: (value: boolean) => void;
  unreadNotifications: number;
  markNotificationsRead: () => void;
  wishlistIds: number[];
  toggleWishlist: (id: number) => boolean;
  isWishlisted: (id: number) => boolean;
  bookings: SavedBooking[];
  addBooking: (booking: SavedBooking) => void;
  /** Reconcile the local store with the authoritative server list (prunes stale bookings). */
  syncServerBookings: (serverBookings: SavedBooking[]) => void;
  updateBookingStatus: (id: string, status: BookingStatus, backendStatus?: string) => void;
  getBookingById: (id: string) => SavedBooking | undefined;
  toast: string | null;
  showToast: (message: string) => void;
  clearToast: () => void;
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      isDarkMode: false,
      toggleDarkMode: () => set((state) => ({ isDarkMode: !state.isDarkMode })),

      locationId: LOCATIONS[0].id,
      setLocationId: (id) => {
        set({ locationId: id });
        const loc = LOCATIONS.find((l) => l.id === id);
        get().showToast(`Location: ${loc?.label ?? "updated"}`);
      },

      activePromo: null,
      setActivePromo: (code) => set({ activePromo: code }),

      overlay: null,
      openOverlay: (o) => set({ overlay: o }),
      closeOverlay: () => set({ overlay: null }),

      isPremium: false,
      setPremium: (value) => {
        set({ isPremium: value });
        if (value) get().showToast("Welcome to Homeeigo Premium!");
      },

      unreadNotifications: 1,
      markNotificationsRead: () => set({ unreadNotifications: 0 }),

      wishlistIds: [],
      toggleWishlist: (id) => {
        const has = get().wishlistIds.includes(id);
        set({
          wishlistIds: has
            ? get().wishlistIds.filter((x) => x !== id)
            : [...get().wishlistIds, id],
        });
        return !has;
      },
      isWishlisted: (id) => get().wishlistIds.includes(id),

      bookings: [],
      addBooking: (booking) =>
        set((state) => ({
          bookings: [booking, ...state.bookings.filter((b) => b.id !== booking.id)],
        })),

      // Backend is the source of truth: keep exactly what it returns so stale
      // bookings persisted from a previous session/reseed are dropped (prevents
      // "Booking not found" when opening a dead local booking).
      syncServerBookings: (serverBookings) =>
        set(() => {
          const seen = new Set<string>();
          const unique = serverBookings.filter((b) => {
            if (seen.has(b.id)) return false;
            seen.add(b.id);
            return true;
          });
          return { bookings: unique };
        }),

      updateBookingStatus: (id, status, backendStatus) => {
        const now = new Date().toISOString();
        set((state) => ({
          bookings: state.bookings.map((b) => {
            if (b.id !== id) return b;
            return {
              ...b,
              status,
              updatedAt: now,
              cancelledAt: status === "cancelled" ? now : b.cancelledAt,
              completedAt: status === "completed" ? now : b.completedAt,
              backendStatus: backendStatus ?? b.backendStatus,
              timeline: backendStatus
                ? customerTimelineFromBackendStatus(backendStatus, now)
                : patchTimeline(b.timeline, status, now),
            };
          }),
        }));
      },

      getBookingById: (id) => get().bookings.find((b) => b.id === id),

      toast: null,
      showToast: (message) => {
        set({ toast: message });
        setTimeout(() => {
          if (get().toast === message) set({ toast: null });
        }, 3200);
      },
      clearToast: () => set({ toast: null }),
    }),
    {
      name: "homigo-app-v2",
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        locationId: s.locationId,
        activePromo: s.activePromo,
        isDarkMode: s.isDarkMode,
        isPremium: s.isPremium,
        wishlistIds: s.wishlistIds,
      }),
    },
  ),
);
