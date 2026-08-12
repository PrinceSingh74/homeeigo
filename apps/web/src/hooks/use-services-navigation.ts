"use client";

import { useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/stores/app-store";
import { bookUrl, type BookParams } from "@/lib/booking-url";
import { searchServices } from "@/lib/services";
import { useServicesQuery } from "@/hooks/use-core-data";

export function useServicesNavigation() {
  const router = useRouter();
  const openOverlay = useAppStore((s) => s.openOverlay);
  const closeOverlay = useAppStore((s) => s.closeOverlay);
  const showToast = useAppStore((s) => s.showToast);
  const setActivePromo = useAppStore((s) => s.setActivePromo);
  const { data } = useServicesQuery();

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
      const apiMatch = data?.services?.find((s) =>
        `${s.name} ${s.description ?? ""}`.toLowerCase().includes(q.toLowerCase()),
      );
      const match = apiMatch ? { id: apiMatch.id } : searchServices(q)[0];
      if (match) book({ service: match.id, q });
      else book({ q });
    },
    [book, data?.services, showToast],
  );

  const openBookingsWithTracking = useCallback(() => {
    closeOverlay();
    router.push("/bookings");
    showToast("Opening your live bookings", "success");
  }, [closeOverlay, router, showToast]);

  return {
    book,
    bookFromSearch,
    bookFirstOffer: () => book({ service: "deep-cleaning", promo: "HOME150" }),
    openCategories: () => openOverlay("services-categories"),
    openTrending: () => {
      closeOverlay();
      router.push("/providers");
    },
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
