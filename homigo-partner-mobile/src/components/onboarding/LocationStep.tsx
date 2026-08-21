import { useEffect, useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";
import * as Location from "expo-location";
import { OnboardingField } from "@/components/onboarding/OnboardingField";
import { partnerRegistrationApi } from "@/services/partner-registration-api";
import { partnerColors } from "@/theme/colors";

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
  error?: string;
  loading: boolean;
  onChange: (patch: {
    city?: string;
    serviceRegions?: string;
    serviceRadiusKm?: string;
    latitude?: string;
    longitude?: string;
  }) => void;
  onSubmit: () => void;
}) {
  const [search, setSearch] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [zones, setZones] = useState<string[]>([]);
  const lat = Number(latitude);
  const lng = Number(longitude);
  const hasPoint = Number.isFinite(lat) && Number.isFinite(lng);

  useEffect(() => {
    if (error && /outside|service area/i.test(error) && (latitude || longitude)) {
      onChange({ latitude: "", longitude: "" });
    }
  }, [error, latitude, longitude, onChange]);
  const radius = Number(serviceRadiusKm) || 5;
  const mapUri = hasPoint
    ? `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=13&size=640x360&markers=${lat},${lng},red-pushpin`
    : null;

  async function applyCoords(nextLat: number, nextLng: number) {
    onChange({ latitude: String(nextLat), longitude: String(nextLng) });
    try {
      const geo = await partnerRegistrationApi.reverseGeocode(nextLat, nextLng);
      if (geo.address?.city) onChange({ city: geo.address.city });
      if (geo.address?.formattedAddress && !serviceRegions) onChange({ serviceRegions: geo.address.formattedAddress });
      setZones((geo.coverageZones ?? []).map((z) => z.name));
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Could not reverse geocode");
    }
  }

  async function useGps() {
    setLocalError(null);
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
  }

  async function runSearch() {
    const q = search.trim();
    if (q.length < 3) return;
    setLocalError(null);
    try {
      const result = await partnerRegistrationApi.searchLocation(q);
      if (!result.address) {
        setLocalError("No match found. Enter city and areas manually.");
        onChange({ latitude: "", longitude: "" });
        return;
      }
      onChange({ city: result.address.city ?? q });
      await applyCoords(result.address.latitude, result.address.longitude);
    } catch (e) {
      setLocalError(e instanceof Error ? e.message : "Search failed");
    }
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Service location</Text>
      <Text style={styles.copy}>Choose where you want to receive jobs. GPS is optional.</Text>
      {mapUri ? (
        <Image accessibilityLabel="Selected location map" source={{ uri: mapUri }} style={styles.map} />
      ) : (
        <View style={styles.mapFallback}>
          <Text style={styles.meta}>Search or use current location to preview coverage.</Text>
        </View>
      )}
      <OnboardingField label="Search area" value={search} placeholder="Andheri, Mumbai" onChangeText={setSearch} />
      <View style={styles.row}>
        <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => void runSearch()}>
          <Text style={styles.secondaryText}>Search</Text>
        </Pressable>
        <Pressable accessibilityRole="button" style={styles.secondary} onPress={() => void useGps()}>
          <Text style={styles.secondaryText}>{Platform.OS === "web" ? "Use location" : "Current location"}</Text>
        </Pressable>
      </View>
      <OnboardingField label="Base city" value={city} placeholder="Gurugram" onChangeText={(v) => onChange({ city: v })} />
      <OnboardingField
        label="Service areas"
        value={serviceRegions}
        placeholder="Andheri, Bandra"
        onChangeText={(v) => onChange({ serviceRegions: v })}
      />
      <OnboardingField
        label={`Preferred radius (${radius} km)`}
        value={serviceRadiusKm}
        placeholder="5"
        keyboardType="numeric"
        onChangeText={(v) => onChange({ serviceRadiusKm: v })}
      />
      {zones.length ? <Text style={styles.meta}>Coverage zones: {zones.join(", ")}</Text> : null}
      {localError || error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {localError || error}
        </Text>
      ) : null}
      <Pressable accessibilityRole="button" style={styles.button} disabled={loading} onPress={onSubmit}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save & Continue</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  title: { fontSize: 20, fontWeight: "800", color: partnerColors.text, letterSpacing: -0.3 },
  copy: { color: partnerColors.textSecondary, lineHeight: 20 },
  map: { width: "100%", height: 180, borderRadius: 16, backgroundColor: "#e8eef5" },
  mapFallback: {
    height: 120,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: partnerColors.line,
    alignItems: "center",
    justifyContent: "center",
    padding: 16,
    backgroundColor: "rgba(255,255,255,0.8)",
  },
  row: { flexDirection: "row", gap: 8 },
  secondary: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: partnerColors.line,
    paddingVertical: 12,
    minHeight: 44,
    alignItems: "center",
  },
  secondaryText: { fontWeight: "700", color: partnerColors.primary },
  meta: { fontSize: 12, color: partnerColors.textMuted },
  error: { color: partnerColors.danger, fontSize: 13 },
  button: {
    backgroundColor: partnerColors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: "#fff", fontWeight: "700" },
});
