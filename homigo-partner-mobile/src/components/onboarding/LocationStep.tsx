import { LocateFixed, Search } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Image, Platform, StyleSheet, View } from "react-native";
import * as Location from "expo-location";
import { OnboardingFrame, Problem } from "@/components/onboarding/OnboardingFrame";
import { Button, Card, Field, T } from "@/components/ui";
import { ONBOARDING_LIMITS, digitsOnly, registrationErrorSentence } from "@/lib/onboarding-form";
import { partnerRegistrationApi } from "@/services/partner-registration-api";
import { color, radius, space } from "@/theme/tokens";

/**
 * Step 4: `POST /onboarding/location` — a base city, the areas served and a radius of 1–50 km;
 * coordinates are optional and must be inside the service area when sent.
 */
export function LocationStep({
  city,
  serviceRegions,
  serviceRadiusKm,
  latitude,
  longitude,
  error,
  loading,
  onChange,
  onSubmit,
}: {
  city: string;
  serviceRegions: string;
  serviceRadiusKm: string;
  latitude?: string;
  longitude?: string;
  /** The step's own check, or the server's refusal of the last save. */
  error?: string;
  loading: boolean;
  onChange: (patch: { city?: string; serviceRegions?: string; serviceRadiusKm?: string; latitude?: string; longitude?: string }) => void;
  onSubmit: () => void;
}) {
  const [search, setSearch] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [zones, setZones] = useState<string[]>([]);
  const [busy, setBusy] = useState<"search" | "gps" | null>(null);
  const lat = Number(latitude);
  const lng = Number(longitude);
  const hasPoint = Boolean(latitude?.trim()) && Boolean(longitude?.trim()) && Number.isFinite(lat) && Number.isFinite(lng);

  // A point the server refused as outside the service area is dropped, so the next save can go
  // through on the city and areas alone.
  useEffect(() => {
    if (error && /outside|service area/i.test(error) && (latitude || longitude)) {
      onChange({ latitude: "", longitude: "" });
    }
  }, [error, latitude, longitude, onChange]);

  const radiusKm = Number(serviceRadiusKm) || 5;
  const mapUri = hasPoint ? `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=13&size=640x360&markers=${lat},${lng},red-pushpin` : null;

  async function applyCoords(nextLat: number, nextLng: number) {
    onChange({ latitude: String(nextLat), longitude: String(nextLng) });
    try {
      const geo = await partnerRegistrationApi.reverseGeocode(nextLat, nextLng);
      if (geo.address?.city) onChange({ city: geo.address.city });
      if (geo.address?.formattedAddress && !serviceRegions) onChange({ serviceRegions: geo.address.formattedAddress });
      setZones((geo.coverageZones ?? []).map((z) => z.name));
    } catch (e) {
      setLocalError(registrationErrorSentence(e, "The address for this spot could not be looked up. Enter your city and areas below."));
    }
  }

  async function useGps() {
    if (busy) return;
    setLocalError(null);
    setBusy("gps");
    try {
      const perm = await Location.requestForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        setLocalError("Location permission denied. Search an address instead.");
        return;
      }
      try {
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        await applyCoords(pos.coords.latitude, pos.coords.longitude);
      } catch {
        setLocalError("Current location unavailable. Search an address instead.");
      }
    } finally {
      setBusy(null);
    }
  }

  async function runSearch() {
    const q = search.trim();
    if (q.length < 3 || busy) return;
    setLocalError(null);
    setBusy("search");
    try {
      const result = await partnerRegistrationApi.searchLocation(q);
      if (!result?.address) {
        setLocalError("No match found. Enter city and areas manually.");
        onChange({ latitude: "", longitude: "" });
        return;
      }
      onChange({ city: result.address.city ?? q });
      await applyCoords(result.address.latitude, result.address.longitude);
    } catch (e) {
      setLocalError(registrationErrorSentence(e, "Search failed"));
      onChange({ latitude: "", longitude: "" });
    } finally {
      setBusy(null);
    }
  }

  return (
    <OnboardingFrame
      heading="Service location"
      lead="Choose where you want to receive jobs. Using your current location is optional."
      error={error}
      primary={<Button testID="onboarding-save-continue" label="Save & continue" onPress={onSubmit} loading={loading} />}
    >
      <Card style={styles.card}>
        {mapUri ? (
          <Image accessibilityLabel="Selected location map" source={{ uri: mapUri }} style={styles.map} />
        ) : (
          <View style={styles.mapEmpty}>
            <T kind="small" style={styles.center}>
              Search or use current location to preview coverage.
            </T>
          </View>
        )}
        <Field
          label="Search area"
          value={search}
          onChangeText={setSearch}
          help="At least 3 letters, for example Andheri, Mumbai."
          autoCorrect={false}
          autoComplete="off"
          returnKeyType="search"
          onSubmitEditing={() => void runSearch()}
        />
        <View style={styles.row}>
          <Button label="Search" variant="secondary" icon={Search} onPress={() => void runSearch()} loading={busy === "search"} disabled={busy === "gps" || search.trim().length < 3} style={styles.half} />
          <Button
            label={Platform.OS === "web" ? "Use location" : "Current location"}
            variant="secondary"
            icon={LocateFixed}
            onPress={() => void useGps()}
            loading={busy === "gps"}
            disabled={busy === "search"}
            style={styles.half}
          />
        </View>
        {localError ? <Problem message={localError} testID="onboarding-location-problem" /> : null}
        {zones.length ? <T kind="small">Coverage zones: {zones.join(", ")}</T> : null}
      </Card>
      <Card style={styles.card}>
        <Field
          label="Base city"
          value={city}
          onChangeText={(v) => onChange({ city: v })}
          maxLength={ONBOARDING_LIMITS.city}
          autoCapitalize="words"
          autoCorrect={false}
          autoComplete="off"
        />
        <Field
          label="Service areas"
          value={serviceRegions}
          onChangeText={(v) => onChange({ serviceRegions: v })}
          help="Separate areas with commas, for example Andheri, Bandra."
          autoCapitalize="words"
          autoCorrect={false}
          autoComplete="off"
        />
        <Field
          label={`Preferred radius (${radiusKm} km)`}
          value={serviceRadiusKm}
          onChangeText={(v) => onChange({ serviceRadiusKm: digitsOnly(v, ONBOARDING_LIMITS.radiusKm) })}
          help="Between 1 and 50 km."
          keyboardType="number-pad"
          maxLength={ONBOARDING_LIMITS.radiusKm}
          autoComplete="off"
        />
      </Card>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.lg },
  map: { width: "100%", height: 180, borderRadius: radius.control, backgroundColor: color.well },
  mapEmpty: { minHeight: 96, borderRadius: radius.control, borderWidth: 1, borderColor: color.line, backgroundColor: color.well, alignItems: "center", justifyContent: "center", padding: space.lg },
  center: { textAlign: "center" },
  row: { flexDirection: "row", gap: space.sm },
  half: { flex: 1 },
});
