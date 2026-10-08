import type { ReactNode } from "react";
import { StyleSheet } from "react-native";
import { OnboardingFrame } from "@/components/onboarding/OnboardingFrame";
import { Button, Card, Field } from "@/components/ui";
import { ONBOARDING_LIMITS, PASSWORD_HELP, digitsOnly, validateAccount, type AccountForm } from "@/lib/onboarding-form";
import { space } from "@/theme/tokens";

export { validateAccount, type AccountForm };

/**
 * Step 1: the account. `POST /api/partner/register/step1` takes email, a 10-digit Indian mobile
 * (the server adds +91), first and last name (2–50) and the password twice.
 */
export function AccountStep({
  form,
  email,
  errors,
  loading,
  after,
  onChange,
  onEmailChange,
  onSubmit,
}: {
  form: AccountForm;
  email: string;
  errors: Record<string, string>;
  loading: boolean;
  /** Shown under the form (the way back to sign-in). */
  after?: ReactNode;
  onChange: (patch: Partial<AccountForm>) => void;
  onEmailChange: (email: string) => void;
  onSubmit: () => void;
}) {
  return (
    <OnboardingFrame
      heading="Basic information"
      lead="Create your partner account. We send an OTP to your mobile to verify it."
      primary={<Button label="Send OTP & create account" onPress={onSubmit} loading={loading} />}
    >
      <Card style={styles.card}>
        <Field
          label="First name"
          value={form.firstName}
          onChangeText={(v) => onChange({ firstName: v })}
          error={errors.firstName}
          maxLength={ONBOARDING_LIMITS.name}
          autoCapitalize="words"
          autoCorrect={false}
          autoComplete="given-name"
          textContentType="givenName"
          returnKeyType="next"
        />
        <Field
          label="Last name"
          value={form.lastName}
          onChangeText={(v) => onChange({ lastName: v })}
          error={errors.lastName}
          maxLength={ONBOARDING_LIMITS.name}
          autoCapitalize="words"
          autoCorrect={false}
          autoComplete="family-name"
          textContentType="familyName"
          returnKeyType="next"
        />
        <Field
          label="Email"
          value={email}
          onChangeText={onEmailChange}
          error={errors.email}
          help="You sign in with this email."
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="email"
          textContentType="emailAddress"
          returnKeyType="next"
        />
        <Field
          label="Mobile"
          accessibilityLabel="Phone"
          value={form.phoneNumber}
          onChangeText={(v) => onChange({ phoneNumber: digitsOnly(v, ONBOARDING_LIMITS.phone) })}
          error={errors.phoneNumber}
          help="10 digits, without +91."
          keyboardType="phone-pad"
          maxLength={ONBOARDING_LIMITS.phone}
          autoComplete="tel-national"
          textContentType="telephoneNumber"
          returnKeyType="next"
        />
        <Field
          label="Password"
          value={form.password}
          onChangeText={(v) => onChange({ password: v })}
          error={errors.password}
          help={PASSWORD_HELP}
          secure
          maxLength={ONBOARDING_LIMITS.password}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="next"
        />
        <Field
          label="Confirm password"
          value={form.confirmPassword}
          onChangeText={(v) => onChange({ confirmPassword: v })}
          error={errors.confirmPassword}
          secure
          maxLength={ONBOARDING_LIMITS.password}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="done"
          onSubmitEditing={onSubmit}
        />
      </Card>
      {after}
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.lg },
});
