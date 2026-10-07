import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { LifeBuoy, Siren } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { BulletList, SubHeading } from "@/components/job/parts";
import { Button, T } from "@/components/ui";
import { partnerApi } from "@/services/partner-api";
import { space } from "@/theme/tokens";

/**
 * Where to turn when something goes wrong on this job. Built only from what exists: the booking's
 * frozen incident / emergency protocol text (same query and cache as SafetyPanel), the two in-app
 * escalation actions (report a prohibited condition; Escalate on a service step — same query and
 * cache as ExecutionSteps), and the app's own SOS and Help and support screens. No phone number or
 * contact is written here; the SOS screen shows the ones the server has configured.
 */
export function EscalationCard({ bookingId, enabled = true }: { bookingId: string; enabled?: boolean }) {
  const on = !!bookingId && enabled;
  const safety = useQuery({ queryKey: ["partner", "safety", bookingId], queryFn: () => partnerApi.getSafety(bookingId), enabled: on, staleTime: 10_000 });
  const execution = useQuery({ queryKey: ["partner", "execution", bookingId], queryFn: () => partnerApi.getExecution(bookingId), enabled: on, staleTime: 10_000 });

  const incident = safety.data?.safety?.incidentProtocol ?? null;
  const emergency = safety.data?.safety?.emergencyProtocol ?? null;
  const canReport = (safety.data?.canReport ?? []).length > 0;
  const canEscalateStep = (execution.data?.steps ?? []).some((s) => s.actions.includes("ESCALATE"));

  return (
    <View testID="job-escalation" style={styles.stack}>
      {incident ? (
        <View style={styles.group} testID="escalation-incident-protocol">
          <SubHeading>If there is an incident</SubHeading>
          <T kind="body">{incident}</T>
        </View>
      ) : null}
      {emergency ? (
        <View style={styles.group} testID="escalation-emergency-protocol">
          <SubHeading>In an emergency</SubHeading>
          <T kind="body">{emergency}</T>
        </View>
      ) : null}
      {on ? (
        <BulletList
          label="In this app"
          testID="escalation-pointers"
          items={[
            `Unsafe or prohibited condition on site: use “Stop work and alert safety team” under Safety. It stops the job and alerts the safety team.${canReport ? " Available now." : ""}`,
            `A service step you cannot finish safely or correctly: use “Escalate” on that step under Service steps. It goes to the support team for review.${canEscalateStep ? " Available now." : ""}`,
          ]}
        />
      ) : null}
      <View style={styles.actions}>
        <Button
          testID="escalation-sos-link"
          label="Open SOS"
          icon={Siren}
          variant="danger"
          accessibilityLabel="Open SOS. Opens the SOS screen, where you can alert operations"
          onPress={() => router.push("/hq/wellbeing-sos")}
        />
        <Button
          testID="escalation-support-link"
          label="Help and support"
          icon={LifeBuoy}
          variant="secondary"
          accessibilityLabel="Open Help and support. Opens your support tickets"
          onPress={() => router.push("/hq/account-support")}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  group: { gap: space.xs },
  actions: { gap: space.sm },
});
