import { ScrollView, StyleSheet, Text, View } from "react-native";
import { MOBILE_STEPPER, stepperIdForStep } from "@/lib/onboarding-catalog";
import { partnerColors } from "@/theme/colors";

export function OnboardingStepper({ currentStep }: { currentStep: string }) {
  const currentId = stepperIdForStep(currentStep);
  const currentIndex = MOBILE_STEPPER.findIndex((s) => s.id === currentId);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {MOBILE_STEPPER.map((step, index) => {
        const done = index < currentIndex;
        const active = index === currentIndex;
        return (
          <View key={step.id} style={styles.item}>
            <View style={[styles.dot, done && styles.dotDone, active && styles.dotActive]}>
              <Text style={[styles.dotText, done && styles.dotTextDone, active && styles.dotTextOn]}>
                {done ? "✓" : index + 1}
              </Text>
            </View>
            <Text style={[styles.label, active && styles.labelActive]}>{step.label}</Text>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { gap: 12, paddingRight: 8, alignItems: "center" },
  item: { alignItems: "center", gap: 6, minWidth: 56 },
  dot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: partnerColors.line,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.9)",
  },
  dotActive: { borderColor: partnerColors.primary, backgroundColor: partnerColors.primary },
  dotDone: { borderColor: partnerColors.primary, backgroundColor: "rgba(61,107,79,0.16)" },
  dotText: { fontSize: 11, fontWeight: "800", color: partnerColors.textMuted },
  dotTextOn: { color: "#fff" },
  dotTextDone: { color: partnerColors.primary },
  label: { fontSize: 10, fontWeight: "600", color: partnerColors.textMuted },
  labelActive: { color: partnerColors.primary, fontWeight: "800" },
});
