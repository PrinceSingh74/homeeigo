import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { HqCard } from "@/components/HqUi";
import { partnerApi } from "@/services/partner-api";
import { partnerColors } from "@/theme/colors";

/**
 * Phase 10 §9 — safety for this job (mirror of partner-web SafetyPanel). Everything the booking froze
 * for the professional is shown: what to wear, what not to use, the warnings, the conditions under
 * which work must not go on, and the protocols. The partner can report a prohibited condition from the
 * booking's frozen list; the server stops the job and alerts the safety team. Only the safety team
 * clears a hold.
 */
export function SafetyPanel({ bookingId }: { bookingId: string }) {
  const qc = useQueryClient();
  const [picked, setPicked] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["partner", "safety", bookingId], queryFn: () => partnerApi.getSafety(bookingId), staleTime: 10_000 });
  const report = useMutation({
    mutationFn: () => { setError(null); return partnerApi.reportProhibitedCondition(bookingId, picked!, note.trim() || undefined); },
    onSuccess: () => { setPicked(null); setNote(""); },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not report this"),
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ["partner", "safety", bookingId] });
      void qc.invalidateQueries({ queryKey: ["partner", "execution", bookingId] });
    },
  });
  const v = q.data;
  const s = v?.safety;
  // Bookings frozen before these fields existed (or an older server build) carry none of them.
  const ppe = s?.ppe ?? [];
  const chemicals = s?.chemicalRestrictions ?? [];
  const prohibited = s?.prohibitedConditions ?? [];
  const customerAsked = s?.customerRequirements ?? [];
  const has =
    !!s &&
    (prohibited.length || s.warnings.length || s.providerRequirements.length || ppe.length || chemicals.length || customerAsked.length ||
      s.information || s.medicalDisclaimer || s.emergencyProtocol || s.incidentProtocol);
  if (!v || (!has && v.gate.ok)) return null;
  return (
    <View testID="safety-panel">
      <HqCard>
        <Text style={styles.title} accessibilityRole="header">Safety</Text>
        {!v.gate.ok ? <Text style={styles.hold} accessibilityRole="alert">⛔ Stop — safety hold. {v.gate.message}</Text> : null}
        {s?.information ? <Text style={styles.body}>{s.information}</Text> : null}
        <SafetyList testID="safety-ppe" label="Wear" items={ppe} />
        <SafetyList testID="safety-provider-requirements" label="Bring / have in place" items={s?.providerRequirements ?? []} />
        <SafetyList testID="safety-chemical-restrictions" label="Do not use" glyph="✕" items={chemicals} />
        {s?.warnings.length ? (
          <View style={styles.group}>
            <Text style={styles.label}>Warnings</Text>
            {s.warnings.map((w) => <Text key={w} style={styles.warn}>⚠ {w}</Text>)}
          </View>
        ) : null}
        {/* Read-only, and shown whether or not reporting is available right now. */}
        <SafetyList testID="safety-prohibited-conditions" label="Do not start or continue work if" glyph="⛔" items={prohibited} />
        <SafetyList testID="safety-customer-requirements" label="The customer has been asked to" items={customerAsked} />
        {s?.medicalDisclaimer ? (
          <View style={styles.group} testID="safety-medical-disclaimer">
            <Text style={styles.label}>Medical notice</Text>
            <Text style={styles.body}>{s.medicalDisclaimer}</Text>
          </View>
        ) : null}
        {s?.incidentProtocol ? (
          <View style={styles.group} testID="safety-incident-protocol">
            <Text style={styles.label}>If there is an incident</Text>
            <Text style={styles.body}>{s.incidentProtocol}</Text>
          </View>
        ) : null}
        {s?.emergencyProtocol ? (
          <View style={styles.group} testID="safety-emergency-protocol">
            <Text style={styles.label}>In an emergency</Text>
            <Text style={styles.body}>{s.emergencyProtocol}</Text>
          </View>
        ) : null}
        {v.canReport.length ? (
          <View style={styles.box} accessibilityRole="radiogroup" accessibilityLabel="Report a prohibited condition">
            <Text style={styles.label}>Report a prohibited condition (stops the job)</Text>
            {v.canReport.map((c) => (
              <Pressable key={c} accessibilityRole="radio" accessibilityLabel={c} accessibilityState={{ selected: picked === c, checked: picked === c }} onPress={() => setPicked(c)} style={[styles.choice, picked === c && styles.choiceOn]}>
                <Text style={styles.choiceText}>{picked === c ? "◉" : "○"} {c}</Text>
              </Pressable>
            ))}
            <TextInput value={note} onChangeText={setNote} maxLength={500} placeholder="What did you see? (optional)" placeholderTextColor={partnerColors.textMuted} accessibilityLabel="What did you see" style={styles.input} />
            <Pressable accessibilityRole="button" accessibilityLabel="Stop work and alert safety team" accessibilityState={{ disabled: !picked || report.isPending, busy: report.isPending }} disabled={!picked || report.isPending} onPress={() => report.mutate()} style={[styles.btn, (!picked || report.isPending) && styles.btnDisabled]}>
              <Text style={styles.btnText}>{report.isPending ? "Reporting…" : "Stop work and alert safety team"}</Text>
            </Pressable>
          </View>
        ) : null}
        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      </HqCard>
    </View>
  );
}

function SafetyList({ label, items, glyph = "•", testID }: { label: string; items: readonly string[]; glyph?: string; testID: string }) {
  if (items.length === 0) return null;
  return (
    <View style={styles.group} testID={testID} accessibilityLabel={`${label}: ${items.join(", ")}`}>
      <Text style={styles.label}>{label}</Text>
      {items.map((item) => (
        <Text key={item} style={styles.body}>{glyph} {item}</Text>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 15, fontWeight: "700", color: partnerColors.text, marginBottom: 6 },
  hold: { fontSize: 13, fontWeight: "700", color: "#991b1b", marginBottom: 8 },
  group: { marginTop: 10 },
  body: { fontSize: 13, lineHeight: 19, color: partnerColors.textSecondary, marginTop: 2 },
  warn: { fontSize: 13, lineHeight: 19, color: "#92400e", marginTop: 2 },
  box: { gap: 8, marginTop: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: partnerColors.line, paddingTop: 12 },
  label: { fontSize: 13, fontWeight: "600", color: partnerColors.text },
  choice: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12, paddingVertical: 8, borderRadius: 12, borderWidth: 1, borderColor: partnerColors.line },
  choiceOn: { borderColor: "#dc2626" },
  choiceText: { color: partnerColors.text, fontSize: 13 },
  input: { minHeight: 44, borderWidth: 1, borderColor: partnerColors.line, borderRadius: 12, paddingHorizontal: 12, color: partnerColors.text },
  btn: { minHeight: 44, borderRadius: 12, backgroundColor: "#dc2626", justifyContent: "center", paddingHorizontal: 16 },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  btnDisabled: { opacity: 0.5 },
  error: { color: "#b91c1c", fontSize: 12, marginTop: 8 },
});
