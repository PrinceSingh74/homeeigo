import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { HqCard } from "@/components/HqUi";
import { partnerApi } from "@/services/partner-api";
import { partnerColors } from "@/theme/colors";

/**
 * Escalation for this job — where to turn when something goes wrong. Built only from what exists:
 * the booking's frozen incident / emergency protocol text (same query and cache as SafetyPanel), the
 * two in-app escalation actions (report a prohibited condition; Escalate on a service step — same
 * query and cache as ExecutionSteps), and the app's own SOS and Help & Support screens. No phone
 * number or contact is written here; the SOS screen shows the ones the server has configured.
 */
export function EscalationCard({ bookingId }: { bookingId: string }) {
  const safety = useQuery({ queryKey: ["partner", "safety", bookingId], queryFn: () => partnerApi.getSafety(bookingId), staleTime: 10_000 });
  const execution = useQuery({ queryKey: ["partner", "execution", bookingId], queryFn: () => partnerApi.getExecution(bookingId), staleTime: 10_000 });

  const incident = safety.data?.safety?.incidentProtocol ?? null;
  const emergency = safety.data?.safety?.emergencyProtocol ?? null;
  const canReport = (safety.data?.canReport ?? []).length > 0;
  const canEscalateStep = (execution.data?.steps ?? []).some((s) => s.actions.includes("ESCALATE"));

  return (
    <View testID="job-escalation">
      <HqCard>
        <Text style={styles.title} accessibilityRole="header">Escalation</Text>
        {incident ? (
          <View style={styles.group} testID="escalation-incident-protocol">
            <Text style={styles.label}>If there is an incident</Text>
            <Text style={styles.body}>{incident}</Text>
          </View>
        ) : null}
        {emergency ? (
          <View style={styles.group} testID="escalation-emergency-protocol">
            <Text style={styles.label}>In an emergency</Text>
            <Text style={styles.body}>{emergency}</Text>
          </View>
        ) : null}
        {!incident && !emergency ? (
          <Text style={styles.body}>
            No incident or emergency protocol is set for this job. Two escalation actions are built into this screen:
          </Text>
        ) : (
          <Text style={[styles.label, styles.group]}>In this app</Text>
        )}
        <Text style={styles.body} testID="escalation-pointer-safety">
          • Unsafe or prohibited condition on site — use “Stop work and alert safety team” in the Safety card. It stops the job and alerts the safety team.
          {canReport ? " Available now." : " Shown when this job has a prohibited-conditions list you can report against."}
        </Text>
        <Text style={styles.body} testID="escalation-pointer-step">
          • A service step you cannot finish safely or correctly — use “Escalate” on that step in the Service steps card. It goes to the support team for review.
          {canEscalateStep ? " Available now." : " Shown on a step once it can be escalated."}
        </Text>
        <View style={styles.actions}>
          <Pressable
            testID="escalation-sos-link"
            accessibilityRole="link"
            accessibilityLabel="Open SOS"
            accessibilityHint="Opens the SOS screen, where you can alert operations"
            onPress={() => router.push("/hq/wellbeing-sos")}
            style={styles.btn}
          >
            <Text style={styles.btnText}>Open SOS</Text>
          </Pressable>
          <Pressable
            testID="escalation-support-link"
            accessibilityRole="link"
            accessibilityLabel="Open Help and Support"
            accessibilityHint="Opens your support tickets"
            onPress={() => router.push("/hq/account-support")}
            style={styles.btn}
          >
            <Text style={styles.btnText}>Help & Support</Text>
          </Pressable>
        </View>
      </HqCard>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 15, fontWeight: "700", color: partnerColors.text, marginBottom: 6 },
  group: { marginTop: 10 },
  label: { fontSize: 13, fontWeight: "600", color: partnerColors.text },
  body: { fontSize: 13, lineHeight: 19, color: partnerColors.textSecondary, marginTop: 4 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 12 },
  btn: { minHeight: 44, paddingHorizontal: 14, justifyContent: "center", borderRadius: 12, borderWidth: 1, borderColor: partnerColors.line, backgroundColor: partnerColors.surface },
  btnText: { color: partnerColors.text, fontWeight: "700", fontSize: 13 },
});
