import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { OnboardingField } from "@/components/onboarding/OnboardingField";
import { ONBOARDING_DAYS } from "@/lib/onboarding-catalog";
import { partnerColors } from "@/theme/colors";

export function AvailabilityStep({
  workingHoursStart,
  workingHoursEnd,
  workingDays,
  error,
  loading,
  onChange,
  onToggleDay,
  onSubmit,
}: {
  workingHoursStart: string;
  workingHoursEnd: string;
  workingDays: string[];
  error?: string;
  loading: boolean;
  onChange: (patch: { workingHoursStart?: string; workingHoursEnd?: string }) => void;
  onToggleDay: (day: string) => void;
  onSubmit: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Availability</Text>
      <Text style={styles.copy}>Set your preferred working schedule. You can adjust later in Partner OS.</Text>
      <OnboardingField
        label="Start time"
        value={workingHoursStart}
        placeholder="09:00"
        onChangeText={(v) => onChange({ workingHoursStart: v })}
      />
      <OnboardingField
        label="End time"
        value={workingHoursEnd}
        placeholder="18:00"
        onChangeText={(v) => onChange({ workingHoursEnd: v })}
      />
      <Text style={styles.label}>Working days</Text>
      <View style={styles.row}>
        {ONBOARDING_DAYS.map((day) => {
          const on = workingDays.includes(day);
          return (
            <Pressable
              key={day}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={day}
              onPress={() => onToggleDay(day)}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{day}</Text>
            </Pressable>
          );
        })}
      </View>
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
  row: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    borderRadius: 999,
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
