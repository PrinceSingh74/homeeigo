import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { OnboardingField } from "@/components/onboarding/OnboardingField";
import { ONBOARDING_CITIES, ONBOARDING_SERVICES } from "@/lib/onboarding-catalog";
import { partnerColors } from "@/theme/colors";

export function ServicesStep({
  serviceCategories,
  city,
  experienceYears,
  error,
  loading,
  onToggleService,
  onSelectCity,
  onExperience,
  onSubmit,
}: {
  serviceCategories: string[];
  city: string;
  experienceYears: string;
  error?: string;
  loading: boolean;
  onToggleService: (id: string) => void;
  onSelectCity: (city: string) => void;
  onExperience: (years: string) => void;
  onSubmit: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Services & location</Text>
      <Text style={styles.copy}>Which services do you provide?</Text>
      <View style={styles.grid}>
        {ONBOARDING_SERVICES.map((service) => {
          const on = serviceCategories.includes(service.id);
          return (
            <Pressable
              key={service.id}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={service.label}
              onPress={() => onToggleService(service.id)}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{service.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.label}>City</Text>
      <View style={styles.grid}>
        {ONBOARDING_CITIES.map((item) => {
          const on = city === item;
          return (
            <Pressable
              key={item}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={item}
              onPress={() => onSelectCity(item)}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{item}</Text>
            </Pressable>
          );
        })}
      </View>
      <OnboardingField
        label="Years of experience"
        value={experienceYears}
        placeholder="2"
        keyboardType="numeric"
        onChangeText={onExperience}
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
  label: { fontSize: 13, fontWeight: "600", color: partnerColors.text },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: partnerColors.line,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 44,
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.9)",
  },
  chipOn: { borderColor: partnerColors.primary, backgroundColor: "rgba(61,107,79,0.12)" },
  chipText: { fontSize: 13, fontWeight: "600", color: partnerColors.text },
  chipTextOn: { color: partnerColors.primary, fontWeight: "800" },
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
