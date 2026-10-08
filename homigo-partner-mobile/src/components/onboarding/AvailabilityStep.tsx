import { StyleSheet, View } from "react-native";
import { Choice, ChoiceGroup, OnboardingFrame } from "@/components/onboarding/OnboardingFrame";
import { Button, Card, Field } from "@/components/ui";
import { ONBOARDING_DAYS } from "@/lib/onboarding-catalog";
import { ONBOARDING_LIMITS } from "@/lib/onboarding-form";
import { space } from "@/theme/tokens";

/** Step 5: `POST /onboarding/availability` — start and end time, and at least one working day. */
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
    <OnboardingFrame
      heading="Availability"
      lead="Set your preferred working schedule."
      error={error}
      primary={<Button testID="onboarding-save-continue" label="Save & continue" onPress={onSubmit} loading={loading} />}
    >
      <Card style={styles.card}>
        <View style={styles.row}>
          <View style={styles.half}>
            <Field
              label="Start time"
              value={workingHoursStart}
              onChangeText={(v) => onChange({ workingHoursStart: v })}
              help="24-hour, HH:MM."
              placeholder="09:00"
              keyboardType="numbers-and-punctuation"
              maxLength={ONBOARDING_LIMITS.time}
              autoCorrect={false}
              autoComplete="off"
            />
          </View>
          <View style={styles.half}>
            <Field
              label="End time"
              value={workingHoursEnd}
              onChangeText={(v) => onChange({ workingHoursEnd: v })}
              help="24-hour, HH:MM."
              placeholder="18:00"
              keyboardType="numbers-and-punctuation"
              maxLength={ONBOARDING_LIMITS.time}
              autoCorrect={false}
              autoComplete="off"
            />
          </View>
        </View>
        <ChoiceGroup label="Working days">
          {ONBOARDING_DAYS.map((day) => (
            <Choice key={day} label={day} selected={workingDays.includes(day)} onPress={() => onToggleDay(day)} />
          ))}
        </ChoiceGroup>
      </Card>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.lg },
  row: { flexDirection: "row", gap: space.md },
  half: { flex: 1 },
});
