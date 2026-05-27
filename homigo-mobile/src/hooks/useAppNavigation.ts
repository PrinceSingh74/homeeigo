import { useCallback } from "react";
import { useRouter } from "expo-router";
import { useAppStore } from "@/lib/store";
import { openBook } from "@/lib/navigation";
import { resolveServiceIdFromQuery } from "@/lib/services-search";
import { getLocation } from "@/lib/services";
import type { BookParams } from "@/lib/booking";

/** App-wide navigation — tabs, book flow, and global sheets */
export function useAppNavigation() {
  const router = useRouter();
  const openOverlay = useAppStore((s) => s.openOverlay);
  const closeOverlay = useAppStore((s) => s.closeOverlay);
  const markNotificationsRead = useAppStore((s) => s.markNotificationsRead);
  const locationId = useAppStore((s) => s.locationId);
  const unreadNotifications = useAppStore((s) => s.unreadNotifications);
  const isPremium = useAppStore((s) => s.isPremium);
  const showToast = useAppStore((s) => s.showToast);

  const location = getLocation(locationId);

  const book = useCallback(
    (params: BookParams = {}) => {
      closeOverlay();
      openBook(router, params);
    },
    [router, closeOverlay],
  );

  const goHome = useCallback(() => {
    closeOverlay();
    router.push("/(tabs)");
  }, [router, closeOverlay]);

  const goServices = useCallback(() => {
    closeOverlay();
    router.push("/(tabs)/services");
  }, [router, closeOverlay]);

  const goBookings = useCallback(() => {
    closeOverlay();
    router.push("/(tabs)/bookings");
  }, [router, closeOverlay]);

  const goAi = useCallback(() => {
    closeOverlay();
    router.push("/(tabs)/ai");
  }, [router, closeOverlay]);

  const goWallet = useCallback(() => {
    closeOverlay();
    router.push("/(tabs)/wallet");
  }, [router, closeOverlay]);

  const goProfile = useCallback(() => {
    closeOverlay();
    router.push("/(tabs)/profile");
  }, [router, closeOverlay]);

  const openLocation = useCallback(() => openOverlay("location"), [openOverlay]);

  const openNotifications = useCallback(() => {
    markNotificationsRead();
    openOverlay("notifications");
  }, [markNotificationsRead, openOverlay]);

  return {
    locationLabel: location.city,
    locationFull: location.label,
    unreadNotifications,
    isPremium,
    book,
    bookFromSearch: (query: string) =>
      book({ service: resolveServiceIdFromQuery(query) }),
    bookFirstOffer: () => book({ service: "cleaning", promo: "HOME150" }),
    goHome,
    goServices,
    goBookings,
    goAi,
    goWallet,
    goProfile,
    openProfile: goProfile,
    openAi: goAi,
    openBookings: goBookings,
    openWallet: goWallet,
    openLocation,
    openNotifications,
    openPremium: () => openOverlay("premium"),
    openSettings: () => openOverlay("settings"),
    openAddresses: () => openOverlay("addresses"),
    openTransactions: () => openOverlay("transactions"),
    openReferral: () => openOverlay("referral"),
    openAddMoney: () => openOverlay("add-money"),
    openCategories: () => openOverlay("categories"),
    openTrending: () => openOverlay("trending"),
    openAiRecommendations: () => openOverlay("ai-recommendations"),
    openReviews: () => openOverlay("reviews"),
    closeOverlay,
    showToast,
  };
}
