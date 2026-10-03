import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { HqCard } from "@/components/HqUi";
import { partnerApi } from "@/services/partner-api";
import { partnerColors } from "@/theme/colors";

/**
 * Phase 10 §9 — safety for this job (mirror of partner-web SafetyPanel). The partner can report a
 * prohibited condition from the booking's frozen list; the server stops the job and alerts the safety
 * team. Only the safety team clears a hold.
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
  const has = !!s && (s.prohibitedConditions.length || s.warnings.length || s.providerRequirements.length || s.emergencyProtocol);
  if (!v || (!has && v.gate.ok)) return null;
  return (
    <View testID="safety-panel">
      <HqCard>
        <Text style={styles.title}>Safety</Text>
        {!v.gate.ok ? <Text style={styles.hold} accessibilityRole="alert">⛔ Stop — safety hold. {v.gate.message}</Text> : null}
        {s?.providerRequirements.length ? <Text style={styles.meta}>Wear / bring: {s.providerRequirements.join(", ")}</Text> : null}
        {s?.warnings.map((w) => <Text key={w} style={styles.warn}>⚠ {w}</Text>)}
        {s?.emergencyProtocol ? <Text style={styles.meta}>In an emergency: {s.emergencyProtocol}</Text> : null}
        {v.canReport.length ? (
          <View style={styles.box}>
            <Text style={styles.label}>Report a prohibited condition (stops the job)</Text>
            {v.canReport.map((c) => (
              <Pressable key={c} accessibilityRole="radio" accessibilityState={{ selected: picked === c }} onPress={() => setPicked(c)} style={[styles.choice, picked === c && styles.choiceOn]}>
                <Text style={styles.choiceText}>{picked === c ? "◉" : "○"} {c}</Text>
              </Pressable>
            ))}
            <TextInput value={note} onChangeText={setNote} maxLength={500} placeholder="What did you see? (optional)" accessibilityLabel="What did you see" style={styles.input} />
            <Pressable accessibilityRole="button" accessibilityLabel="Stop work and alert safety team" disabled={!picked || report.isPending} onPress={() => report.mutate()} style={[styles.btn, (!picked || report.isPending) && styles.btnDisabled]}>
              <Text style={styles.btnText}>Stop work and alert safety team</Text>
            </Pressable>
          </View>
        ) : null}
        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      </HqCard>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 15, fontWeight: "700", color: partnerColors.text, marginBottom: 6 },
  hold: { fontSize: 13, fontWeight: "700", color: "#991b1b", marginBottom: 8 },
  meta: { fontSize: 12, color: partnerColors.textSecondary, marginTop: 2 },
  warn: { fontSize: 12, color: "#92400e", marginTop: 2 },
  box: { gap: 8, marginTop: 10, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: partnerColors.line, paddingTop: 10 },
  label: { fontSize: 13, fontWeight: "600", color: partnerColors.text },
  choice: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12, borderRadius: 12, borderWidth: 1, borderColor: partnerColors.line },
  choiceOn: { borderColor: "#dc2626" },
  choiceText: { color: partnerColors.text, fontSize: 13 },
  input: { minHeight: 44, borderWidth: 1, borderColor: partnerColors.line, borderRadius: 12, paddingHorizontal: 12, color: partnerColors.text },
  btn: { minHeight: 44, borderRadius: 12, backgroundColor: "#dc2626", justifyContent: "center", paddingHorizontal: 16 },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  btnDisabled: { opacity: 0.5 },
  error: { color: "#b91c1c", fontSize: 12, marginTop: 8 },
});
