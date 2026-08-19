import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { OnboardingField } from "@/components/onboarding/OnboardingField";
import { partnerColors } from "@/theme/colors";

export type AccountForm = {
  firstName: string;
  lastName: string;
  phoneNumber: string;
  password: string;
  confirmPassword: string;
};

export function validateAccount(form: AccountForm, email: string): Record<string, string> {
  const errors: Record<string, string> = {};
  if (form.firstName.trim().length < 2) errors.firstName = "Min 2 characters";
  if (form.lastName.trim().length < 2) errors.lastName = "Min 2 characters";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) errors.email = "Invalid email";
  if (!/^[0-9]{10}$/.test(form.phoneNumber.trim())) errors.phoneNumber = "Enter 10 digit number";
  if (form.password.length < 8) errors.password = "Min 8 characters";
  if (form.password !== form.confirmPassword) errors.confirmPassword = "Passwords don't match";
  return errors;
}

export function AccountStep({
  form,
  email,
  errors,
  loading,
  locked,
  onChange,
  onEmailChange,
  onSubmit,
}: {
  form: AccountForm;
  email: string;
  errors: Record<string, string>;
  loading: boolean;
  locked?: boolean;
  onChange: (patch: Partial<AccountForm>) => void;
  onEmailChange: (email: string) => void;
  onSubmit: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Basic information</Text>
      <Text style={styles.copy}>Create your partner account. We verify your mobile with OTP.</Text>
      <OnboardingField
        label="First name"
        value={form.firstName}
        placeholder="Rahul"
        error={errors.firstName}
        editable={!locked}
        onChangeText={(v) => onChange({ firstName: v })}
      />
      <OnboardingField
        label="Last name"
        value={form.lastName}
        placeholder="Sharma"
        error={errors.lastName}
        editable={!locked}
        onChangeText={(v) => onChange({ lastName: v })}
      />
      <OnboardingField
        label="Email"
        value={email}
        placeholder="you@email.com"
        keyboardType="email-address"
        autoCapitalize="none"
        error={errors.email}
        editable={!locked}
        onChangeText={onEmailChange}
      />
      <OnboardingField
        label="Mobile"
        accessibilityLabel="Phone"
        value={form.phoneNumber}
        placeholder="10-digit mobile"
        keyboardType="phone-pad"
        maxLength={10}
        prefix="+91"
        error={errors.phoneNumber}
        editable={!locked}
        onChangeText={(v) => onChange({ phoneNumber: v.replace(/\D/g, "").slice(0, 10) })}
      />
      <OnboardingField
        label="Password"
        value={form.password}
        placeholder="Min 8 characters"
        secureTextEntry
        error={errors.password}
        editable={!locked}
        onChangeText={(v) => onChange({ password: v })}
      />
      <OnboardingField
        label="Confirm password"
        value={form.confirmPassword}
        placeholder="Confirm"
        secureTextEntry
        error={errors.confirmPassword}
        editable={!locked}
        onChangeText={(v) => onChange({ confirmPassword: v })}
      />
      <Pressable accessibilityRole="button" style={styles.button} disabled={loading} onPress={onSubmit}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Send OTP & create account</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  title: { fontSize: 20, fontWeight: "800", color: partnerColors.text, letterSpacing: -0.3 },
  copy: { color: partnerColors.textSecondary, lineHeight: 20 },
  button: {
    marginTop: 4,
    backgroundColor: partnerColors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: "#fff", fontWeight: "700" },
});
