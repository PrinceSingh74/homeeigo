import { StyleSheet } from "react-native";
import { Choice, ChoiceGroup, OnboardingFrame } from "@/components/onboarding/OnboardingFrame";
import { Button, Card, Field } from "@/components/ui";
import { ONBOARDING_GENDERS } from "@/lib/onboarding-catalog";
import { ONBOARDING_LIMITS, digitsOnly, validateProfile } from "@/lib/onboarding-form";
import { space } from "@/theme/tokens";

export { validateProfile };

/** Step 3: `POST /onboarding/profile` — date of birth, gender, and who to call in an emergency. */
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
  onChange: (patch: { dateOfBirth?: string; gender?: string; emergencyName?: string; emergencyPhone?: string }) => void;
  onSubmit: () => void;
}) {
  return (
    <OnboardingFrame
      heading="Complete your profile"
      lead="A few details about you, and who we should call in an emergency."
      primary={<Button testID="onboarding-save-continue" label="Save & continue" onPress={onSubmit} loading={loading} />}
    >
      <Card style={styles.card}>
        <Field
          label="Date of birth"
          value={dateOfBirth}
          onChangeText={(v) => onChange({ dateOfBirth: v })}
          error={errors.dateOfBirth}
          help="Year, month, day: YYYY-MM-DD."
          placeholder="YYYY-MM-DD"
          keyboardType="numbers-and-punctuation"
          maxLength={ONBOARDING_LIMITS.dateOfBirth}
          autoCorrect={false}
          autoComplete="birthdate-full"
        />
        <ChoiceGroup label="Gender" error={errors.gender}>
          {ONBOARDING_GENDERS.map((g) => (
            <Choice key={g.id} label={g.label} selected={gender === g.id} onPress={() => onChange({ gender: g.id })} />
          ))}
        </ChoiceGroup>
        <Field
          testID="onboarding-emergency-name"
          label="Emergency contact name"
          value={emergencyName}
          onChangeText={(v) => onChange({ emergencyName: v })}
          error={errors.emergencyName}
          maxLength={ONBOARDING_LIMITS.emergencyName}
          autoCapitalize="words"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          textContentType="none"
          importantForAutofill="no"
        />
        <Field
          label="Emergency contact phone"
          value={emergencyPhone}
          onChangeText={(v) => onChange({ emergencyPhone: digitsOnly(v, ONBOARDING_LIMITS.phone) })}
          error={errors.emergencyPhone}
          help="10 digits, without +91."
          keyboardType="phone-pad"
          maxLength={ONBOARDING_LIMITS.phone}
          autoComplete="off"
          textContentType="none"
          importantForAutofill="no"
        />
      </Card>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.lg },
});
