import { useMemo } from "react";
import { useWalletBalanceQuery, useBookingsQuery, useAddressesQuery } from "@/hooks/use-core-data";
import { formatINR } from "@/lib/wallet-mobile-data";

export function useProfileDerived() {
  const { data: walletData } = useWalletBalanceQuery();
  const { data: bookingsData } = useBookingsQuery();
  const { data: addressesData } = useAddressesQuery();

  const activeBookings = useMemo(
    () =>
      (bookingsData?.bookings ?? []).filter(
        (b) => b.status !== "completed" && !String(b.status).startsWith("cancelled"),
      ).length,
    [bookingsData?.bookings],
  );

  const addressCount = addressesData?.addresses?.length ?? 0;

  const quickStats = useMemo(
    () => ({
      walletBalance: formatINR(walletData?.balance ?? 0),
      activeBookings,
      addressCount: String(addressCount),
    }),
    [walletData?.balance, activeBookings, addressCount],
  );

  const insights = useMemo(() => {
    const completed = (bookingsData?.bookings ?? []).filter((b) => b.status === "completed").length;
    if (completed >= 3) {
      return [
        {
          id: "maintenance",
          title: "Seasonal maintenance due",
          body: "Based on your booking history, schedule AC service before summer peak.",
          action: "Book AC Service",
          serviceId: "ac-service",
        },
        {
          id: "savings",
          title: "Wallet savings opportunity",
          body: "Top up your wallet now to unlock faster checkout on repeat bookings.",
          action: "Open Wallet",
          serviceId: "cleaning",
        },
      ];
    }
    return [
      {
        id: "welcome",
        title: "Complete your first booking",
        body: "Explore featured services and book a verified Homeeigo professional today.",
        action: "Browse Services",
        serviceId: "cleaning",
      },
    ];
  }, [bookingsData?.bookings]);

  return { quickStats, insights };
}
