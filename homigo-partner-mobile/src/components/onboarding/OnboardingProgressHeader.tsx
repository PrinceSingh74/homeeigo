import { View, Text, StyleSheet } from "react-native";
import { partnerColors } from "@/theme/colors";
import { formatLastSaved } from "@/lib/onboarding-resume";

export function OnboardingProgressHeader({
  percentComplete,
  resumeLabel,
  lastSavedAt,
  restored,
}: {
  percentComplete: number;
  resumeLabel: string;
  lastSavedAt?: string | null;
  restored?: boolean;
}) {
  const saved = formatLastSaved(lastSavedAt);
  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        <Text style={styles.percent}>{percentComplete}% complete</Text>
        <Text style={styles.step}>{resumeLabel}</Text>
      </View>
      <View style={styles.track}>
        <View style={[styles.fill, { width: `${Math.min(100, percentComplete)}%` }]} />
      </View>
      {restored ? (
        <Text style={styles.saved}>
          Continue from {resumeLabel}
          {saved ? ` · ${saved}` : ""}
        </Text>
      ) : (
        <Text style={styles.saved}>Progress saves automatically</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: partnerColors.line,
    backgroundColor: "rgba(255,255,255,0.92)",
    padding: 14,
    gap: 8,
  },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  percent: { fontSize: 13, fontWeight: "700", color: partnerColors.primary },
  step: { fontSize: 12, fontWeight: "600", color: partnerColors.textMuted },
  track: { height: 6, borderRadius: 999, backgroundColor: "rgba(37,99,235,0.12)", overflow: "hidden" },
  fill: { height: "100%", borderRadius: 999, backgroundColor: partnerColors.primary },
  saved: { fontSize: 11, color: partnerColors.textMuted },
});
