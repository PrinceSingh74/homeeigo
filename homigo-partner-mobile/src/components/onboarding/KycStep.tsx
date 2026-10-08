import { StyleSheet } from "react-native";
import { OnboardingFrame } from "@/components/onboarding/OnboardingFrame";
import { Button, Card, Field } from "@/components/ui";
import { ONBOARDING_LIMITS, digitsOnly, validateKyc } from "@/lib/onboarding-form";
import { space } from "@/theme/tokens";

export { validateKyc };

/**
 * Step 6: `POST /register/kyc-details`. Every field is optional to the server; one that is filled
 * must have its shape (PAN AAAAA1234B, Aadhaar 12 digits, account 9–18 digits, IFSC 4 letters, 0,
 * 6 letters or digits, names 2–100).
 */
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
    <OnboardingFrame
      heading="KYC & banking"
      lead="These are optional at this step. Fill in what you have."
      primary={<Button label="Save & continue" onPress={onSubmit} loading={loading} />}
    >
      <Card style={styles.card}>
        <Field
          label="PAN"
          value={panNumber}
          onChangeText={(v) => onChange({ panNumber: v.toUpperCase() })}
          error={errors.panNumber}
          help="10 characters, for example AAAAA1234B."
          maxLength={ONBOARDING_LIMITS.pan}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
          importantForAutofill="no"
        />
        <Field
          label="Aadhaar"
          value={aadharNumber}
          onChangeText={(v) => onChange({ aadharNumber: digitsOnly(v, ONBOARDING_LIMITS.aadhaar) })}
          error={errors.aadharNumber}
          help="12 digits."
          keyboardType="number-pad"
          maxLength={ONBOARDING_LIMITS.aadhaar}
          autoComplete="off"
          importantForAutofill="no"
        />
      </Card>
      <Card style={styles.card}>
        <Field
          label="Bank account number"
          value={bankAccountNumber}
          onChangeText={(v) => onChange({ bankAccountNumber: digitsOnly(v, ONBOARDING_LIMITS.bankAccount) })}
          help="9 to 18 digits."
          keyboardType="number-pad"
          maxLength={ONBOARDING_LIMITS.bankAccount}
          autoComplete="off"
          importantForAutofill="no"
        />
        <Field
          label="Account holder"
          value={bankAccountHolder}
          onChangeText={(v) => onChange({ bankAccountHolder: v })}
          help="The name on the account."
          maxLength={ONBOARDING_LIMITS.bankHolder}
          autoCapitalize="words"
          autoCorrect={false}
          autoComplete="off"
        />
        <Field
          label="IFSC"
          value={ifscCode}
          onChangeText={(v) => onChange({ ifscCode: v.toUpperCase() })}
          help="11 characters, for example HDFC0001234."
          maxLength={ONBOARDING_LIMITS.ifsc}
          autoCapitalize="characters"
          autoCorrect={false}
          autoComplete="off"
        />
        <Field
          label="Bank name"
          value={bankName}
          onChangeText={(v) => onChange({ bankName: v })}
          maxLength={ONBOARDING_LIMITS.bankName}
          autoCapitalize="words"
          autoCorrect={false}
          autoComplete="off"
        />
      </Card>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.lg },
});
