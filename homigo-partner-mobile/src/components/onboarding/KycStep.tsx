import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { OnboardingField } from "@/components/onboarding/OnboardingField";
import { partnerColors } from "@/theme/colors";

export function validateKyc(input: { panNumber: string; aadharNumber: string }): Record<string, string> {
  const errors: Record<string, string> = {};
  if (input.panNumber && !/^[A-Z]{5}[0-9]{4}[A-Z]$/i.test(input.panNumber.trim())) {
    errors.panNumber = "Invalid PAN (e.g. AAAAA1234B)";
  }
  if (input.aadharNumber && !/^\d{12}$/.test(input.aadharNumber.trim())) {
    errors.aadharNumber = "Aadhar must be 12 digits";
  }
  return errors;
}

export function KycStep({
  panNumber,
  aadharNumber,
  bankAccountNumber,
  bankAccountHolder,
  ifscCode,
  bankName,
  errors,
  loading,
  onChange,
  onSubmit,
}: {
  panNumber: string;
  aadharNumber: string;
  bankAccountNumber: string;
  bankAccountHolder: string;
  ifscCode: string;
  bankName: string;
  errors: Record<string, string>;
  loading: boolean;
  onChange: (patch: Record<string, string>) => void;
  onSubmit: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>KYC & banking</Text>
      <Text style={styles.copy}>Optional now — you can add these later from your profile.</Text>
      <OnboardingField
        label="PAN"
        value={panNumber}
        placeholder="AAAAA1234B"
        autoCapitalize="characters"
        error={errors.panNumber}
        onChangeText={(v) => onChange({ panNumber: v.toUpperCase() })}
      />
      <OnboardingField
        label="Aadhaar"
        value={aadharNumber}
        placeholder="12 digits"
        keyboardType="numeric"
        maxLength={12}
        error={errors.aadharNumber}
        onChangeText={(v) => onChange({ aadharNumber: v.replace(/\D/g, "").slice(0, 12) })}
      />
      <OnboardingField
        label="Bank account number"
        value={bankAccountNumber}
        placeholder="Account number"
        keyboardType="numeric"
        onChangeText={(v) => onChange({ bankAccountNumber: v })}
      />
      <OnboardingField
        label="Account holder"
        value={bankAccountHolder}
        placeholder="Name on passbook"
        onChangeText={(v) => onChange({ bankAccountHolder: v })}
      />
      <OnboardingField
        label="IFSC"
        value={ifscCode}
        placeholder="HDFC0001234"
        autoCapitalize="characters"
        onChangeText={(v) => onChange({ ifscCode: v.toUpperCase() })}
      />
      <OnboardingField
        label="Bank name"
        value={bankName}
        placeholder="HDFC Bank"
        onChangeText={(v) => onChange({ bankName: v })}
      />
      <Pressable accessibilityRole="button" style={styles.button} disabled={loading} onPress={onSubmit}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Save & continue</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  title: { fontSize: 20, fontWeight: "800", color: partnerColors.text, letterSpacing: -0.3 },
  copy: { color: partnerColors.textSecondary, lineHeight: 20 },
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
