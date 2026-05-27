"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/stores/app-store";
import { bookUrl, type BookParams } from "@/lib/booking-url";
import { ensureDemoTrackingBooking } from "@/lib/demo-tracking-booking";
import { searchServices } from "@/lib/services";

export function useServicesNavigation() {
  const router = useRouter();
  const openOverlay = useAppStore((s) => s.openOverlay);
  const closeOverlay = useAppStore((s) => s.closeOverlay);
  const showToast = useAppStore((s) => s.showToast);
  const addBooking = useAppStore((s) => s.addBooking);
  const bookings = useAppStore((s) => s.bookings);
  const setActivePromo = useAppStore((s) => s.setActivePromo);

  const book = useCallback(
    (params: BookParams = {}) => {
      closeOverlay();
      if (params.promo) setActivePromo(params.promo);
      router.push(bookUrl(params));
    },
    [closeOverlay, router, setActivePromo],
  );

  const bookFromSearch = useCallback(
    (query: string) => {
      const q = query.trim();
      if (!q) {
        showToast("Type a service to search", "info");
        return;
      }
      const match = searchServices(q)[0];
      if (match) book({ service: match.id, q });
      else book({ q });
    },
    [book, showToast],
  );

  const openBookingsWithTracking = useCallback(() => {
    ensureDemoTrackingBooking(bookings, addBooking);
    closeOverlay();
    router.push("/bookings");
    showToast("Live tracking ready — see your active booking", "success");
  }, [addBooking, bookings, closeOverlay, router, showToast]);

  return {
    book,
    bookFromSearch,
    bookFirstOffer: () => book({ service: "cleaning", promo: "HOME150" }),
    openCategories: () => openOverlay("services-categories"),
    openTrending: () => openOverlay("services-trending"),
    openAiRecommendations: () => openOverlay("services-ai"),
    openReviews: () => openOverlay("services-reviews"),
    openQuickFilters: () => openOverlay("quick-filters"),
    openPremium: () => openOverlay("premium"),
    openHowItWorks: () => openOverlay("how-it-works"),
    openWallet: () => openOverlay("wallet"),
    openSupport: () => openOverlay("support"),
    openProfile: () => openOverlay("profile"),
    openBookings: () => {
      closeOverlay();
      router.push("/bookings");
    },
    openBookingsWithTracking,
    goBook: () => {
      closeOverlay();
      router.push("/book");
    },
    closeOverlay,
    showToast,
  };
}
