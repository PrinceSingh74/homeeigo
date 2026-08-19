import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { OnboardingField } from "@/components/onboarding/OnboardingField";
import { ONBOARDING_GENDERS } from "@/lib/onboarding-catalog";
import { partnerColors } from "@/theme/colors";

export function validateProfile(input: {
  dateOfBirth: string;
  gender: string;
  emergencyName: string;
  emergencyPhone: string;
}): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateOfBirth.trim())) errors.dateOfBirth = "Use YYYY-MM-DD";
  if (!input.gender) errors.gender = "Select gender";
  if (input.emergencyName.trim().length < 2) errors.emergencyName = "Enter emergency contact name";
  if (!/^[0-9]{10}$/.test(input.emergencyPhone.trim())) errors.emergencyPhone = "Enter 10 digit number";
  return errors;
}

export function ProfileStep({
  dateOfBirth,
  gender,
  emergencyName,
  emergencyPhone,
  errors,
  loading,
  onChange,
  onSubmit,
}: {
  dateOfBirth: string;
  gender: string;
  emergencyName: string;
  emergencyPhone: string;
  errors: Record<string, string>;
  loading: boolean;
  onChange: (patch: {
    dateOfBirth?: string;
    gender?: string;
    emergencyName?: string;
    emergencyPhone?: string;
  }) => void;
  onSubmit: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Complete your profile</Text>
      <Text style={styles.copy}>Help us match you with the right jobs.</Text>
      <OnboardingField
        label="Date of birth"
        value={dateOfBirth}
        placeholder="YYYY-MM-DD"
        error={errors.dateOfBirth}
        onChangeText={(v) => onChange({ dateOfBirth: v })}
      />
      <Text style={styles.label}>Gender</Text>
      <View style={styles.row}>
        {ONBOARDING_GENDERS.map((g) => {
          const on = gender === g.id;
          return (
            <Pressable
              key={g.id}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={g.label}
              onPress={() => onChange({ gender: g.id })}
              style={[styles.chip, on && styles.chipOn]}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{g.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {errors.gender ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {errors.gender}
        </Text>
      ) : null}
      <OnboardingField
        label="Emergency contact name"
        value={emergencyName}
        placeholder="Name"
        error={errors.emergencyName}
        onChangeText={(v) => onChange({ emergencyName: v })}
      />
      <OnboardingField
        label="Emergency contact phone"
        value={emergencyPhone}
        placeholder="10-digit mobile"
        keyboardType="phone-pad"
        maxLength={10}
        error={errors.emergencyPhone}
        onChangeText={(v) => onChange({ emergencyPhone: v.replace(/\D/g, "").slice(0, 10) })}
      />
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
