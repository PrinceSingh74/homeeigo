import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { BulletList, NoteField, PanelEmpty, PanelError, PanelLoading, SubHeading } from "@/components/job/parts";
import { Banner, Button, T } from "@/components/ui";
import { jobActionsKey } from "@/hooks/job/use-job-lifecycle";
import { failureSentence } from "@/lib/job-screen";
import { partnerApi } from "@/services/partner-api";
import { color, radius, space, tone, touch } from "@/theme/tokens";

/**
 * Phase 10 §9 — safety for this job (mirror of partner web's SafetyPanel). Everything the booking
 * froze for the professional is shown in the server's words: what to wear, what not to use, the
 * warnings, the conditions under which work must not go on, and the protocols. The partner can
 * report a prohibited condition from the booking's frozen list; the server stops the job and alerts
 * the safety team. Only the safety team clears a hold.
 *
 * Loading, "no safety rules" and a failed load are three different things on screen.
 */
export function SafetyPanel({ bookingId, enabled = true }: { bookingId: string; enabled?: boolean }) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reported, setReported] = useState(false);
  const q = useQuery({ queryKey: ["partner", "safety", bookingId], queryFn: () => partnerApi.getSafety(bookingId), enabled: !!bookingId && enabled, staleTime: 10_000 });
  const report = useMutation({
    mutationFn: (condition: string) => partnerApi.reportProhibitedCondition(bookingId, condition, note.trim() || undefined),
    onMutate: () => {
      setError(null);
      setReported(false);
    },
    onSuccess: () => {
      setPicked(null);
      setNote("");
      setReported(true);
    },
    onError: (e) => setError(failureSentence(e, "This could not be reported.")),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["partner", "safety", bookingId] }),
        qc.invalidateQueries({ queryKey: ["partner", "execution", bookingId] }),
        // A hold changes what the footer button may do.
        qc.invalidateQueries({ queryKey: jobActionsKey(bookingId) }),
      ]),
  });

  if (q.isLoading) return <PanelLoading label="Loading safety rules" />;
  if (q.isError && !q.data) return <PanelError error={q.error} onRetry={() => void q.refetch()} retrying={q.isFetching} testID="safety-load-error" />;
  const v = q.data;
  if (!v) return <PanelEmpty testID="safety-empty">No safety rules are recorded for this job.</PanelEmpty>;
  const s = v.safety;
  // Bookings frozen before these fields existed (or an older server build) carry none of them.
  const ppe = s?.ppe ?? [];
  const chemicals = s?.chemicalRestrictions ?? [];
  const prohibited = s?.prohibitedConditions ?? [];
  const customerAsked = s?.customerRequirements ?? [];
  const warnings = s?.warnings ?? [];
  const bring = s?.providerRequirements ?? [];
  const has = !!s && (prohibited.length || warnings.length || bring.length || ppe.length || chemicals.length || customerAsked.length || s.information || s.medicalDisclaimer || s.emergencyProtocol || s.incidentProtocol);

  return (
    <View testID="safety-panel" style={styles.stack}>
      {!v.gate.ok ? <Banner tone="danger" title="Stop. Safety hold" message={v.gate.message} testID="safety-hold" /> : null}
      {reported ? <Banner tone="success" message="Reported. The safety team has been alerted." testID="safety-reported" /> : null}
      {!has && v.gate.ok && v.canReport.length === 0 ? <PanelEmpty testID="safety-empty">No safety rules are recorded for this job.</PanelEmpty> : null}
      {s?.information ? <T kind="body">{s.information}</T> : null}
      <BulletList testID="safety-ppe" label="Wear" items={ppe} />
      <BulletList testID="safety-provider-requirements" label="Bring or have in place" items={bring} />
      <BulletList testID="safety-chemical-restrictions" label="Do not use" items={chemicals} />
      <BulletList testID="safety-warnings" label="Warnings" items={warnings} tone="warning" />
      {/* Read-only, and shown whether or not reporting is available right now. */}
      <BulletList testID="safety-prohibited-conditions" label="Do not start or continue work if" items={prohibited} tone="danger" />
      <BulletList testID="safety-customer-requirements" label="The customer has been asked to" items={customerAsked} />
      {s?.medicalDisclaimer ? (
        <View style={styles.group} testID="safety-medical-disclaimer">
          <SubHeading>Medical notice</SubHeading>
          <T kind="body">{s.medicalDisclaimer}</T>
        </View>
      ) : null}
      {s?.incidentProtocol ? (
        <View style={styles.group} testID="safety-incident-protocol">
          <SubHeading>If there is an incident</SubHeading>
          <T kind="body">{s.incidentProtocol}</T>
        </View>
      ) : null}
      {s?.emergencyProtocol ? (
        <View style={styles.group} testID="safety-emergency-protocol">
          <SubHeading>In an emergency</SubHeading>
          <T kind="body">{s.emergencyProtocol}</T>
        </View>
      ) : null}

      {v.canReport.length ? (
        <View style={styles.report} testID="safety-report">
          <SubHeading>Report a prohibited condition</SubHeading>
          <T kind="small">Reporting stops the job and alerts the safety team. Only they can clear it.</T>
          <View accessibilityRole="radiogroup" accessibilityLabel="Which condition did you find" style={styles.group}>
            {v.canReport.map((c) => {
              const on = picked === c;
              return (
                <Pressable
                  key={c}
                  onPress={() => setPicked(c)}
                  accessibilityRole="radio"
                  accessibilityLabel={c}
                  accessibilityState={{ selected: on, checked: on }}
                  style={({ pressed }) => [styles.choice, on ? styles.choiceOn : null, pressed ? styles.choicePressed : null]}
                >
                  <View style={[styles.radio, on ? styles.radioOn : null]}>{on ? <View style={styles.radioDot} /> : null}</View>
                  <T kind="body" style={styles.flex}>
                    {c}
                  </T>
                </Pressable>
              );
            })}
          </View>
          <NoteField label="What did you see? (optional)" value={note} onChangeText={setNote} maxLength={500} testID="safety-note" />
          <Button
            label="Stop work and alert safety team"
            variant="danger"
            onPress={() => (picked ? report.mutate(picked) : undefined)}
            loading={report.isPending}
            disabled={!picked}
            hint={picked ? null : "Choose the condition you found first."}
            testID="safety-report-submit"
          />
        </View>
      ) : null}
      {error ? <Banner tone="danger" message={error} testID="safety-error" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stack: { gap: space.md },
  group: { gap: space.xs },
  report: { gap: space.sm, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  choice: { minHeight: touch.min, flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.md, paddingVertical: space.sm, borderRadius: radius.control, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface },
  choiceOn: { borderColor: color.danger, backgroundColor: tone.danger.bg },
  choicePressed: { backgroundColor: color.well },
  radio: { width: 22, height: 22, borderRadius: radius.pill, borderWidth: 2, borderColor: color.slate, alignItems: "center", justifyContent: "center" },
  radioOn: { borderColor: color.danger },
  radioDot: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: color.danger },
});
