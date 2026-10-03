import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { HqCard } from "@/components/HqUi";
import { getJobCoords, LOCATION_REQUIRED_MESSAGE } from "@/lib/job-coords";
import { partnerApi } from "@/services/partner-api";
import { partnerColors } from "@/theme/colors";
import type { RequirementItemView } from "@/types/partner";

/**
 * Phase 10 §6 — the partner's requirement checklist (mirror of partner-web RequirementChecklist).
 *
 * The server's view of the booking's own requirement state, and buttons that record what the partner
 * FOUND on site. The server decides the gate; GPS proximity is enforced like arrival. State is
 * perceivable without colour: a glyph plus the state word.
 */

const STATE_LABEL: Record<RequirementItemView["state"], string> = {
  UNRESOLVED: "Not checked yet",
  SATISFIED: "In place",
  FAILED: "Missing",
  EXPIRED: "Check again — the appointment moved",
};
const STATE_GLYPH: Record<RequirementItemView["state"], string> = { UNRESOLVED: "○", SATISFIED: "✓", FAILED: "✕", EXPIRED: "↻" };
const POINT_LABEL: Record<RequirementItemView["enforcementPoint"], string> = {
  BEFORE_BOOKING: "confirmed at booking",
  BEFORE_ARRIVAL: "before arrival",
  AT_START: "before start",
};

export function RequirementChecklist({ bookingId, active }: { bookingId: string; active: boolean }) {
  const qc = useQueryClient();
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({
    queryKey: ["partner", "requirements", bookingId],
    queryFn: () => partnerApi.getRequirements(bookingId),
    enabled: !!bookingId,
    staleTime: 10_000,
  });
  const check = useMutation({
    mutationFn: async (vars: { code: string; outcome: "SATISFIED" | "FAILED" }) => {
      setError(null);
      const c = await getJobCoords("strict");
      if (!c) throw new Error(LOCATION_REQUIRED_MESSAGE);
      return partnerApi.checkRequirement(bookingId, vars.code, vars.outcome, c.latitude, c.longitude, vars.outcome === "FAILED" && note.trim() ? note.trim() : undefined);
    },
    onSuccess: () => {
      setNoteFor(null);
      setNote("");
      void qc.invalidateQueries({ queryKey: ["partner", "requirements", bookingId] });
      void qc.invalidateQueries({ queryKey: ["partner", "job-actions", bookingId] });
      void qc.invalidateQueries({ queryKey: ["partner", "bookings"] });
    },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not record this check"),
  });

  const view = query.data;
  if (!view || !view.enforced || view.items.length === 0) return null;
  const gate = view.gate.start;

  return (
    <View testID="requirement-checklist">
      <HqCard>
        <Text style={styles.title}>Requirements</Text>
        {active ? (
          <Text
            accessibilityRole="text"
            testID={gate.ok ? "requirement-gate-ok" : "requirement-gate-blocked"}
            style={[styles.gate, gate.ok ? styles.gateOk : styles.gateBlocked]}
          >
            {gate.ok ? "All requirements are in place." : `Start is blocked — ${gate.blocking.length} item${gate.blocking.length === 1 ? "" : "s"} to resolve on site.`}
          </Text>
        ) : null}
        {view.items.map((item) => {
          const canCheck = active && item.actions.includes("CHECK");
          const busy = check.isPending && check.variables?.code === item.code;
          return (
            <View key={item.code} style={styles.item} testID={`requirement-${item.code}`} accessibilityLabel={`${item.label}: ${STATE_LABEL[item.state]}`}>
              <Text style={styles.label}>
                {STATE_GLYPH[item.state]} {item.label}
                {item.optional ? " (optional)" : ""}
              </Text>
              <Text style={styles.meta}>
                {STATE_LABEL[item.state]} · {POINT_LABEL[item.enforcementPoint]} · {item.responsibility === "CUSTOMER" ? "customer provides" : item.responsibility === "PROFESSIONAL" ? "you provide" : "shared"}
              </Text>
              {item.blocking ? <Text style={styles.remediation}>{item.blocking.remediation.text}</Text> : null}
              {item.note ? <Text style={styles.meta}>Your note: {item.note}</Text> : null}
              {canCheck ? (
                <View style={styles.actions}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Record ${item.label} as in place`}
                    disabled={busy}
                    onPress={() => check.mutate({ code: item.code, outcome: "SATISFIED" })}
                    style={[styles.btn, styles.btnPrimary, busy && styles.btnDisabled]}
                  >
                    <Text style={styles.btnPrimaryText}>{item.state === "SATISFIED" ? "Re-check: in place" : "In place"}</Text>
                  </Pressable>
                  {noteFor === item.code ? (
                    <View style={styles.noteBox}>
                      <TextInput
                        value={note}
                        onChangeText={setNote}
                        maxLength={500}
                        placeholder="What is missing? (optional)"
                        accessibilityLabel="What is missing"
                        style={styles.input}
                      />
                      <View style={styles.actions}>
                        <Pressable accessibilityRole="button" accessibilityLabel={`Record ${item.label} as missing`} disabled={busy} onPress={() => check.mutate({ code: item.code, outcome: "FAILED" })} style={[styles.btn, styles.btnDanger, busy && styles.btnDisabled]}>
                          <Text style={styles.btnDangerText}>Confirm missing</Text>
                        </Pressable>
                        <Pressable accessibilityRole="button" onPress={() => { setNoteFor(null); setNote(""); }} style={[styles.btn, styles.btnGhost]}>
                          <Text style={styles.btnGhostText}>Cancel</Text>
                        </Pressable>
                      </View>
                    </View>
                  ) : (
                    <Pressable accessibilityRole="button" accessibilityLabel={`Report ${item.label} as missing`} disabled={busy} onPress={() => setNoteFor(item.code)} style={[styles.btn, styles.btnGhost, busy && styles.btnDisabled]}>
                      <Text style={styles.btnGhostText}>Not in place</Text>
                    </Pressable>
                  )}
                </View>
              ) : null}
            </View>
          );
        })}
        {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
      </HqCard>
    </View>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 15, fontWeight: "700", color: partnerColors.text, marginBottom: 6 },
  gate: { fontSize: 13, fontWeight: "600", marginBottom: 8 },
  gateOk: { color: "#15803d" },
  gateBlocked: { color: "#92400e" },
  item: { paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: partnerColors.line },
  label: { fontSize: 14, fontWeight: "600", color: partnerColors.text },
  meta: { fontSize: 12, color: partnerColors.textSecondary, marginTop: 2 },
  remediation: { fontSize: 12, color: "#92400e", marginTop: 2 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  btn: { minHeight: 44, paddingHorizontal: 14, justifyContent: "center", borderRadius: 12 },
  btnPrimary: { backgroundColor: partnerColors.primary },
  btnPrimaryText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  btnDanger: { borderWidth: 1, borderColor: "#dc2626" },
  btnDangerText: { color: "#b91c1c", fontWeight: "700", fontSize: 13 },
  btnGhost: { borderWidth: 1, borderColor: partnerColors.line },
  btnGhostText: { color: partnerColors.text, fontWeight: "700", fontSize: 13 },
  btnDisabled: { opacity: 0.5 },
  noteBox: { width: "100%", gap: 8 },
  input: { minHeight: 44, borderWidth: 1, borderColor: partnerColors.line, borderRadius: 12, paddingHorizontal: 12, color: partnerColors.text },
  error: { color: "#b91c1c", fontSize: 12, marginTop: 8 },
});
