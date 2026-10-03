import { useMemo, useState } from "react";
import { ActivityIndicator, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from "react-native-maps";
import { useQuery } from "@tanstack/react-query";
import { useIsFocused } from "@react-navigation/native";
import Constants from "expo-constants";
import { partnerApi } from "@/services/partner-api";
import { partnerColors } from "@/theme/colors";
import { usePartnerMapLocation } from "@/hooks/use-partner-map-location";
import { buildMapJobs, fitRegion, formatEta, type MapJob } from "@/lib/partner-map";
import { decodePolyline } from "@/lib/polyline";
import { MAP_UNAVAILABLE_NOTE, nativeMapAvailable } from "@/lib/maps-availability";

/**
 * Work the partner is actually committed to right now. Must be the server's own `active` key —
 * `provider.service.ts`'s STATUS_MAP maps it to exactly ACCEPTED/ASSIGNED/EN_ROUTE/IN_PROGRESS.
 * A comma-separated list is NOT supported: the lookup misses, falls back to
 * `[status.toUpperCase()]`, and Prisma rejects that invalid enum value with a 500 (observed).
 */
const ACTIVE_STATUSES = "active";

function Banner({ tone, text }: { tone: "warn" | "info" | "danger"; text: string }) {
  const bg = tone === "danger" ? "#fee2e2" : tone === "warn" ? "#fef3c7" : "#e0f2fe";
  const fg = tone === "danger" ? partnerColors.danger : tone === "warn" ? partnerColors.warning : "#0369a1";
  return (
    <View style={[styles.banner, { backgroundColor: bg }]}>
      <Text style={[styles.bannerText, { color: fg }]}>{text}</Text>
    </View>
  );
}

export function PartnerLiveMapScreen() {
  // Only read GPS while this screen is actually on-screen — no background GPS drain.
  const isFocused = useIsFocused();
  const { state: locationState, refresh } = usePartnerMapLocation(isFocused);
  const [selected, setSelected] = useState<MapJob | null>(null);
  // X-74: a build without a Google Maps key crashes the moment a MapView mounts — list the jobs instead.
  const mapAvailable = nativeMapAvailable(Platform.OS, Constants.expoConfig);

  const bookings = useQuery({
    queryKey: ["partner", "map", "active-bookings"],
    queryFn: () => partnerApi.listBookings({ status: ACTIVE_STATUSES, limit: 25 }),
    // Only refetch while the screen is visible; no background polling.
    enabled: isFocused,
    staleTime: 30_000,
  });

  /**
   * Route is best-effort enrichment, never a precondition for showing the map. It legitimately
   * 409s with NO_LOCATION before the server has a live fix for this provider, so a failure must
   * degrade to "markers without a route line", not an error screen.
   */
  const route = useQuery({
    queryKey: ["partner", "map", "route"],
    queryFn: () => partnerApi.routeOptimize(),
    enabled: isFocused && (bookings.data?.bookings.length ?? 0) > 0,
    retry: false,
    staleTime: 60_000,
  });

  const jobs = useMemo(
    () => buildMapJobs(bookings.data?.bookings, route.data?.sequence),
    [bookings.data?.bookings, route.data?.sequence],
  );

  const partnerCoords =
    locationState.kind === "live" || locationState.kind === "stale" ? locationState.coords : null;

  const region = useMemo(() => fitRegion(partnerCoords, jobs), [partnerCoords, jobs]);
  const routeLine = useMemo(() => decodePolyline(route.data?.polyline), [route.data?.polyline]);

  const droppedForNoCoords = (bookings.data?.bookings.length ?? 0) - jobs.length;

  if (bookings.isLoading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator color={partnerColors.primary} />
        <Text style={styles.mutedText}>Loading your jobs…</Text>
      </View>
    );
  }

  if (bookings.isError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorTitle}>Couldn&apos;t load your jobs</Text>
        <Text style={styles.mutedText}>Check your connection and try again.</Text>
        <Pressable style={styles.button} onPress={() => void bookings.refetch()}>
          <Text style={styles.buttonText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {locationState.kind === "permission_denied" ? (
        <Banner tone="warn" text="Location permission is off — your position isn't shown. Jobs still appear below." />
      ) : null}
      {locationState.kind === "unavailable" ? (
        <Banner tone="warn" text="GPS unavailable right now — your position isn't shown." />
      ) : null}
      {locationState.kind === "stale" ? (
        <Banner
          tone="warn"
          text={`Last known position from ${new Date(locationState.at).toLocaleTimeString()} — not live.`}
        />
      ) : null}
      {route.isError && jobs.length > 0 ? (
        <Banner tone="info" text="Route unavailable — showing job locations without a route line." />
      ) : null}
      {droppedForNoCoords > 0 ? (
        <Banner
          tone="info"
          text={`${droppedForNoCoords} job${droppedForNoCoords > 1 ? "s" : ""} have no map location and aren't shown.`}
        />
      ) : null}

      {jobs.length === 0 && !partnerCoords ? (
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Nothing to map yet</Text>
          <Text style={styles.mutedText}>
            Accepted jobs appear here with their locations and your route.
          </Text>
          <Pressable style={styles.button} onPress={refresh}>
            <Text style={styles.buttonText}>Retry location</Text>
          </Pressable>
        </View>
      ) : mapAvailable ? (
        <MapView
          style={styles.map}
          provider={Platform.OS === "android" ? PROVIDER_GOOGLE : undefined}
          initialRegion={region ?? undefined}
          showsUserLocation={locationState.kind === "live"}
          showsMyLocationButton={false}
          toolbarEnabled={false}
        >
          {/* A stale fix gets its own explicit marker rather than the live blue dot, so an old
              position can never read as the partner's current one. */}
          {locationState.kind === "stale" ? (
            <Marker
              coordinate={locationState.coords}
              title="Last known position"
              description="Not live"
              pinColor={partnerColors.warning}
            />
          ) : null}

          {jobs.map((job) => (
            <Marker
              key={job.bookingId}
              coordinate={job.coords}
              title={job.order != null ? `${job.order}. ${job.serviceName}` : job.serviceName}
              description={job.addressLabel.slice(0, 80)}
              pinColor={partnerColors.primary}
              onPress={() => setSelected(job)}
            />
          ))}

          {routeLine.length > 1 ? (
            <Polyline coordinates={routeLine} strokeWidth={4} strokeColor={partnerColors.primary} />
          ) : null}
        </MapView>
      ) : (
        <View style={styles.centered} testID="live-map-unavailable">
          <Text style={styles.errorTitle}>Map unavailable</Text>
          <Text style={styles.mutedText}>{MAP_UNAVAILABLE_NOTE}</Text>
        </View>
      )}

      {jobs.length === 0 && partnerCoords ? (
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>No active jobs</Text>
          <Text style={styles.mutedText}>Your position is shown. Accepted jobs will appear here.</Text>
        </View>
      ) : null}

      {selected ? (
        <View style={styles.sheet}>
          <Text style={styles.sheetTitle}>{selected.serviceName}</Text>
          <Text style={styles.sheetMeta}>
            {selected.bookingNumber} · {selected.status.replace(/_/g, " ")}
          </Text>
          <Text style={styles.sheetAddress}>{selected.addressLabel}</Text>
          {formatEta(selected.cumulativeEtaMin) ? (
            <Text style={styles.sheetEta}>ETA on route: {formatEta(selected.cumulativeEtaMin)}</Text>
          ) : null}
          <View style={styles.sheetActions}>
            <Pressable
              style={styles.button}
              onPress={() =>
                void Linking.openURL(
                  `https://www.google.com/maps/dir/?api=1&destination=${selected.coords.latitude},${selected.coords.longitude}`,
                )
              }
            >
              <Text style={styles.buttonText}>Navigate</Text>
            </Pressable>
            <Pressable style={styles.buttonGhost} onPress={() => setSelected(null)}>
              <Text style={styles.buttonGhostText}>Close</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {jobs.length > 0 && !selected ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.strip} contentContainerStyle={styles.stripContent}>
          {jobs.map((job) => (
            <Pressable key={job.bookingId} style={styles.chip} onPress={() => setSelected(job)}>
              <Text style={styles.chipTitle} numberOfLines={1}>
                {job.order != null ? `${job.order}. ` : ""}
                {job.serviceName}
              </Text>
              <Text style={styles.chipMeta} numberOfLines={1}>
                {formatEta(job.cumulativeEtaMin) ?? job.status.replace(/_/g, " ")}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: partnerColors.cream },
  map: { flex: 1 },
  centered: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24, gap: 8 },
  errorTitle: { fontSize: 16, fontWeight: "700", color: partnerColors.text },
  mutedText: { fontSize: 13, color: partnerColors.textMuted, textAlign: "center" },
  banner: { paddingHorizontal: 14, paddingVertical: 8 },
  bannerText: { fontSize: 12, fontWeight: "600" },
  button: {
    marginTop: 8,
    backgroundColor: partnerColors.primary,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  buttonText: { color: "#fff", fontSize: 13, fontWeight: "700" },
  buttonGhost: { marginTop: 8, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  buttonGhostText: { color: partnerColors.textMuted, fontSize: 13, fontWeight: "700" },
  sheet: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 12,
    backgroundColor: partnerColors.surface,
    borderRadius: 14,
    padding: 14,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  sheetTitle: { fontSize: 15, fontWeight: "800", color: partnerColors.text },
  sheetMeta: { marginTop: 2, fontSize: 11, color: partnerColors.textMuted },
  sheetAddress: { marginTop: 6, fontSize: 12, color: partnerColors.textMuted, lineHeight: 17 },
  sheetEta: { marginTop: 6, fontSize: 12, fontWeight: "700", color: partnerColors.primary },
  sheetActions: { flexDirection: "row", gap: 10, alignItems: "center" },
  strip: { position: "absolute", left: 0, right: 0, bottom: 12, maxHeight: 74 },
  stripContent: { paddingHorizontal: 12, gap: 10 },
  chip: {
    backgroundColor: partnerColors.surface,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    minWidth: 150,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: partnerColors.line,
  },
  chipTitle: { fontSize: 13, fontWeight: "700", color: partnerColors.text },
  chipMeta: { marginTop: 2, fontSize: 11, color: partnerColors.textMuted },
});
