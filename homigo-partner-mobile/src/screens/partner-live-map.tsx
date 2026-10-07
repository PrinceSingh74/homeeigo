import { useIsFocused } from "@react-navigation/native";
import { useQuery } from "@tanstack/react-query";
import Constants from "expo-constants";
import { router } from "expo-router";
import { ChevronLeft, ExternalLink, LocateFixed, MapPinOff } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Linking, Platform, Pressable, ScrollView, StyleSheet, View } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { SafeAreaView } from "react-native-safe-area-context";
import { ErrorState, ListSkeleton } from "@/components/account/states";
import { openJob } from "@/components/home/JobCard";
import { Banner, Button, EmptyState, ListRow, T } from "@/components/ui";
import { useAuthed } from "@/hooks/account/queries";
import { usePartnerMapLocation } from "@/hooks/use-partner-map-location";
import { BOOKING_LIST_FILTER, bookingStatusLabel } from "@/lib/booking-status";
import { MAP_UNAVAILABLE_NOTE, nativeMapAvailable } from "@/lib/maps-availability";
import { buildMapJobs, fitRegion, formatEta, type MapJob } from "@/lib/partner-map";
import { decodePolyline } from "@/lib/polyline";
import { partnerApi } from "@/services/partner-api";
import { color, elevation, radius, space, touch } from "@/theme/tokens";

function openInMaps(job: MapJob) {
  void Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${job.coords.latitude},${job.coords.longitude}`);
}

/**
 * The partner's active jobs on a map. Directions are NOT in the app: "Open in Maps" hands the
 * destination to the phone's maps app. A job's row opens the job.
 */
export function PartnerLiveMapScreen() {
  const authed = useAuthed();
  // GPS is read only while this screen is on screen.
  const isFocused = useIsFocused();
  const { state: locationState, refresh } = usePartnerMapLocation(isFocused);
  const [selected, setSelected] = useState<MapJob | null>(null);
  // A build without a Google Maps key crashes the moment a MapView mounts (X-74): list the jobs instead.
  const mapAvailable = nativeMapAvailable(Platform.OS, Constants.expoConfig);

  const bookings = useQuery({
    queryKey: ["partner", "map", "active-bookings"],
    // The server's own `active` key (ACCEPTED / ASSIGNED / EN_ROUTE / IN_PROGRESS); a comma list answers 500.
    queryFn: () => partnerApi.listBookings({ status: BOOKING_LIST_FILTER.ACTIVE_WORK, limit: 25 }),
    enabled: authed && isFocused,
    staleTime: 30_000,
  });
  // The route is enrichment: it answers 409 NO_LOCATION before the server has a fix. Its failure
  // means "pins without a route line", never an error screen.
  const route = useQuery({
    queryKey: ["partner", "map", "route"],
    queryFn: () => partnerApi.routeOptimize(),
    enabled: authed && isFocused && (bookings.data?.bookings.length ?? 0) > 0,
    retry: false,
    staleTime: 60_000,
  });

  const jobs = useMemo(() => buildMapJobs(bookings.data?.bookings, route.data?.sequence), [bookings.data?.bookings, route.data?.sequence]);
  const partnerCoords = locationState.kind === "live" || locationState.kind === "stale" ? locationState.coords : null;
  const region = useMemo(() => fitRegion(partnerCoords, jobs), [partnerCoords, jobs]);
  const routeLine = useMemo(() => decodePolyline(route.data?.polyline), [route.data?.polyline]);
  const withoutPin = (bookings.data?.bookings ?? []).filter((b) => !jobs.some((j) => j.bookingId === b.id));

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" style={({ pressed }) => [styles.back, pressed ? styles.pressed : null]}>
          <ChevronLeft color={color.leaf} size={22} />
          <T kind="bodyStrong" tone="leaf">
            Back
          </T>
        </Pressable>
        <T kind="title" accessibilityRole="header" style={styles.flex}>
          Live map
        </T>
        <Pressable onPress={refresh} accessibilityRole="button" accessibilityLabel="Update my location" style={({ pressed }) => [styles.iconBtn, pressed ? styles.pressed : null]} testID="live-map-locate">
          <LocateFixed color={color.leaf} size={22} />
        </Pressable>
      </View>

      {bookings.isLoading ? (
        <View style={styles.pad}>
          <ListSkeleton cards={2} label="Loading your jobs" />
        </View>
      ) : bookings.isError && !bookings.data ? (
        <ErrorState error={bookings.error} title="Your jobs could not be loaded" onRetry={() => void bookings.refetch()} testID="live-map-error" />
      ) : (
        <>
          <View style={styles.banners}>
            {locationState.kind === "permission_denied" ? <Banner tone="warning" message="Location access is off, so your position is not shown. Your jobs are still listed." /> : null}
            {locationState.kind === "unavailable" ? <Banner tone="warning" message="Your phone has no location right now, so your position is not shown." /> : null}
            {locationState.kind === "stale" ? <Banner tone="warning" message={`Your position is from ${new Date(locationState.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })} and may be out of date.`} /> : null}
            {route.isError && jobs.length > 0 ? <Banner tone="info" message="A route could not be worked out. Job locations are shown without a route line." /> : null}
          </View>

          {jobs.length === 0 && withoutPin.length === 0 ? (
            <EmptyState icon={MapPinOff} title="No active jobs to map" message="Jobs you have accepted appear here with their location." testID="live-map-empty" />
          ) : mapAvailable ? (
            <MapView style={styles.map} provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined} initialRegion={region ?? undefined} showsUserLocation={locationState.kind === "live"} showsMyLocationButton={false} toolbarEnabled={false}>
              {/* A stale fix gets its own marker, never the live blue dot. */}
              {locationState.kind === "stale" ? <Marker coordinate={locationState.coords} title="Last known position" description="Not live" pinColor={color.marigold} /> : null}
              {jobs.map((job) => (
                <Marker key={job.bookingId} coordinate={job.coords} title={job.order != null ? `${job.order}. ${job.serviceName}` : job.serviceName} description={job.addressLabel.slice(0, 80)} pinColor={color.leaf} onPress={() => setSelected(job)} />
              ))}
              {routeLine.length > 1 ? <Polyline coordinates={routeLine} strokeWidth={4} strokeColor={color.leaf} /> : null}
            </MapView>
          ) : (
            <View style={styles.pad} testID="live-map-unavailable">
              <Banner tone="info" title="Map unavailable" message={MAP_UNAVAILABLE_NOTE} />
            </View>
          )}

          <View style={styles.panel}>
            {selected ? (
              <View style={styles.selected} testID="live-map-selected">
                <T kind="heading">{selected.serviceName}</T>
                <T kind="small" numeric>
                  {selected.bookingNumber} · {bookingStatusLabel(selected.status)}
                  {formatEta(selected.cumulativeEtaMin) ? ` · about ${formatEta(selected.cumulativeEtaMin)} along the route` : ""}
                </T>
                <T kind="small" tone="ink">
                  {selected.addressLabel}
                </T>
                <Button label="Open job" onPress={() => openJob(selected.bookingId)} testID="live-map-open-job" />
                <Button label="Open in Maps" variant="secondary" icon={ExternalLink} onPress={() => openInMaps(selected)} testID="live-map-open-maps" />
                <Button label="Back to the list" variant="quiet" onPress={() => setSelected(null)} />
              </View>
            ) : (
              <ScrollView style={styles.list} contentContainerStyle={styles.listContent} showsVerticalScrollIndicator={false}>
                {jobs.map((job, i) => (
                  <ListRow
                    key={job.bookingId}
                    testID={`live-map-job-${job.bookingId}`}
                    title={job.order != null ? `${job.order}. ${job.serviceName}` : job.serviceName}
                    subtitle={[bookingStatusLabel(job.status), formatEta(job.cumulativeEtaMin), job.addressLabel].filter(Boolean).join(" · ")}
                    onPress={() => openJob(job.bookingId)}
                    last={i === jobs.length - 1 && withoutPin.length === 0}
                  />
                ))}
                {withoutPin.map((b, i) => (
                  <ListRow key={b.id} testID={`live-map-job-${b.id}`} title={b.service.name} subtitle={`${bookingStatusLabel(b.status, b.arrivedAt)} · no map location sent for this job`} tone="neutral" onPress={() => openJob(b.id)} last={i === withoutPin.length - 1} />
                ))}
              </ScrollView>
            )}
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.paper },
  flex: { flex: 1 },
  pad: { padding: space.xl },
  header: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  back: { minHeight: touch.min, flexDirection: "row", alignItems: "center", gap: space.xs, paddingRight: space.md, borderRadius: radius.control },
  iconBtn: { width: touch.min, height: touch.min, borderRadius: radius.control, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: color.line, backgroundColor: color.surface },
  pressed: { backgroundColor: color.well },
  banners: { paddingHorizontal: space.lg, gap: space.sm },
  map: { flex: 1, marginTop: space.sm },
  panel: { backgroundColor: color.surface, borderTopLeftRadius: radius.sheet, borderTopRightRadius: radius.sheet, borderTopWidth: StyleSheet.hairlineWidth, borderColor: color.line, ...elevation.float },
  selected: { padding: space.xl, gap: space.sm },
  list: { maxHeight: 260 },
  listContent: { paddingHorizontal: space.xl, paddingVertical: space.sm },
});
