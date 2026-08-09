"use client";

import { useMemo } from "react";
import { usePartnerActiveBookingsQuery } from "@/hooks/use-partner-data";
import { useGeolocationWatcher } from "@/hooks/use-geolocation-watcher";
import { usePartnerTrackingPublisher } from "@/hooks/use-partner-tracking-publisher";

/**
 * App-wide GPS → customer pipeline. Mounted once in the partner shell so the
 * customer's live map keeps updating no matter which partner screen is open
 * (dashboard, navigation, requests, …). Renders nothing.
 *
 * The publisher hook throttles to one fix per 5 s and skips duplicates; the
 * geolocation watcher only runs while there is an active trackable job.
 */
export function GlobalTrackingPublisher() {
  const { data } = usePartnerActiveBookingsQuery();
  const activeJob = useMemo(
    () =>
      (data?.bookings ?? []).find((b) =>
        ["accepted", "assigned", "en_route", "in_progress"].includes(b.status),
      ),
    [data?.bookings],
  );

  const coords = useGeolocationWatcher({ enabled: !!activeJob });
  usePartnerTrackingPublisher({
    bookingId: activeJob?.id ?? null,
    coords,
    enabled: !!activeJob,
  });

  return null;
}
