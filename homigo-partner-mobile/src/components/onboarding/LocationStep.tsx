import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { OnboardingField } from "@/components/onboarding/OnboardingField";
import { partnerColors } from "@/theme/colors";

export function LocationStep({
  city,
  serviceRegions,
  serviceRadiusKm,
  error,
  loading,
  onChange,
  onSubmit,
}: {
  city: string;
  serviceRegions: string;
  serviceRadiusKm: string;
  error?: string;
  loading: boolean;
  onChange: (patch: { city?: string; serviceRegions?: string; serviceRadiusKm?: string }) => void;
  onSubmit: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Service location</Text>
      <Text style={styles.copy}>Choose where you want to receive jobs.</Text>
      <OnboardingField
        label="Base city"
        value={city}
        placeholder="Gurugram"
        onChangeText={(v) => onChange({ city: v })}
      />
      <OnboardingField
        label="Service areas"
        value={serviceRegions}
        placeholder="Andheri, Bandra"
        onChangeText={(v) => onChange({ serviceRegions: v })}
      />
      <OnboardingField
        label="Preferred radius (km)"
        value={serviceRadiusKm}
        placeholder="5"
        keyboardType="numeric"
        onChangeText={(v) => onChange({ serviceRadiusKm: v })}
      />
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
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
