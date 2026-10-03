import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { HqCard } from "@/components/HqUi";
import { partnerApi } from "@/services/partner-api";
import { partnerColors } from "@/theme/colors";
import { completeBody, completePlan, stepMetaLabel, stepStateLabel, type CompletePlan, type EvidenceStage } from "@/lib/step-evidence";

/**
 * Phase 10 §8 — the partner's work plan (mirror of partner-web ExecutionSteps). Server truth; buttons
 * ask, the server decides. State = glyph + word, never colour alone.
 */
const GLYPH: Record<string, string> = { COMPLETED: "✓", IN_PROGRESS: "▶", BLOCKED: "🔒", FAILED: "✕", ESCALATED: "!", SKIPPED_WITH_REASON: "–" };

/**
 * PHOTO and BEFORE_AFTER_PHOTOS steps complete against job_evidence rows: the server refuses COMPLETE
 * without them (EVIDENCE_REQUIRED). The partner picks each photo now — a before photo is recorded at the
 * START stage, an after photo at the COMPLETION stage (the server's before/after rule) — and the last
 * id is sent with the step. Nothing is ever attached that the partner did not choose.
 */
async function captureStepPhoto(bookingId: string, code: string, stage: EvidenceStage, prompt: string): Promise<string> {
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], quality: 0.7, base64: true });
  const asset = picked.canceled ? undefined : picked.assets?.[0];
  if (!asset?.base64) throw new Error(prompt);
  const mediaUrl = `data:${asset.mimeType ?? "image/jpeg"};base64,${asset.base64}`;
  const res = await partnerApi.uploadEvidence(bookingId, { stage, mediaUrl, clientUploadId: `m-step-${code}-${stage}-${Date.now()}` });
  return res.evidence.id;
}

export function ExecutionSteps({ bookingId }: { bookingId: string }) {
  const qc = useQueryClient();
  const [reasonFor, setReasonFor] = useState<{ code: string; action: string } | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const query = useQuery({ queryKey: ["partner", "execution", bookingId], queryFn: () => partnerApi.getExecution(bookingId), staleTime: 10_000 });
  const act = useMutation({
    mutationFn: async (v: { code: string; action: string; body?: Record<string, string>; plan?: CompletePlan }) => {
      setError(null);
      let body = v.body;
      if (v.plan?.photos.length) {
        const ids: string[] = [];
        for (const p of v.plan.photos) ids.push(await captureStepPhoto(bookingId, v.code, p.stage, p.prompt));
        body = { ...(v.body ?? {}), ...completeBody(v.plan, ids) };
      }
      return partnerApi.executionAction(bookingId, v.code, v.action, body);
    },
    onSuccess: () => { setReasonFor(null); setText(""); },
    onError: (e) => setError(e instanceof Error ? e.message : "Could not update this step"),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["partner", "execution", bookingId] }),
  });
  const view = query.data;
  if (!view || !view.enforced || view.steps.length === 0) return null;
  return (
    <View testID="execution-steps">
      <HqCard>
        <Text style={styles.title}>Work steps</Text>
        <Text style={[styles.gate, view.gate.ok ? styles.ok : styles.blocked]}>
          {view.gate.ok ? "All required steps are done." : "The job can be completed once every required step is done."}
        </Text>
        {view.steps.map((s) => {
          const busy = act.isPending && act.variables?.code === s.code;
          const plan = completePlan(s.evidence);
          return (
            <View key={s.code} style={styles.item} testID={`step-${s.code}`} accessibilityLabel={`Step ${s.stepNumber}, ${s.title}: ${stepStateLabel(s.state)}`}>
              <Text style={styles.label}>{GLYPH[s.state] ?? "○"} {s.stepNumber}. {s.title}{s.mandatory ? "" : " (optional)"}</Text>
              <Text style={styles.meta}>{stepMetaLabel(s.state, s.evidence)}</Text>
              {s.ppe.length ? <Text style={styles.meta}>Wear: {s.ppe.join(", ")}</Text> : null}
              {s.warnings.map((w) => <Text key={w} style={styles.warn}>⚠ {w}</Text>)}
              <View style={styles.actions}>
                {s.actions.includes("START") ? <Btn label="Start" primary disabled={busy} onPress={() => act.mutate({ code: s.code, action: "start" })} a11y={`Start step ${s.stepNumber}`} /> : null}
                {s.actions.includes("COMPLETE") ? (
                  <Btn
                    label={plan.buttonLabel}
                    primary
                    disabled={busy}
                    onPress={() => {
                      // NOTE steps need the note in the body; photo steps pick their photos first (see captureStepPhoto).
                      if (plan.note) { setReasonFor({ code: s.code, action: "complete" }); setText(""); }
                      else act.mutate({ code: s.code, action: "complete", plan });
                    }}
                    a11y={plan.photos.length || plan.note ? `${plan.buttonLabel.replace(" · Done", "")} and mark step ${s.stepNumber} done` : `Mark step ${s.stepNumber} done`}
                  />
                ) : null}
                {(["SKIP", "FAIL", "ESCALATE"] as const).filter((a) => s.actions.includes(a)).map((a) => (
                  <Btn key={a} label={a === "SKIP" ? "Skip" : a === "FAIL" ? "Couldn't do it" : "Escalate"} disabled={busy} onPress={() => { setReasonFor({ code: s.code, action: a.toLowerCase() }); setText(""); }} a11y={`${a} step ${s.stepNumber}`} />
                ))}
              </View>
              {reasonFor?.code === s.code ? (
                <View style={styles.reasonBox}>
                  <TextInput value={text} onChangeText={setText} maxLength={500} placeholder={reasonFor.action === "complete" ? "Note (required)" : "Reason (required)"} accessibilityLabel={reasonFor.action === "complete" ? "Note" : "Reason"} style={styles.input} />
                  <Btn label="Confirm" disabled={busy || text.trim().length < 3} onPress={() => act.mutate({ code: s.code, action: reasonFor.action, body: reasonFor.action === "complete" ? { note: text.trim() } : { reason: text.trim() } })} a11y="Confirm" />
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

function Btn({ label, onPress, disabled, primary, a11y }: { label: string; onPress: () => void; disabled?: boolean; primary?: boolean; a11y: string }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y} disabled={disabled} onPress={onPress} style={[styles.btn, primary ? styles.btnPrimary : styles.btnGhost, disabled && styles.btnDisabled]}>
      <Text style={primary ? styles.btnPrimaryText : styles.btnGhostText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 15, fontWeight: "700", color: partnerColors.text, marginBottom: 6 },
  gate: { fontSize: 13, fontWeight: "600", marginBottom: 8 },
  ok: { color: "#15803d" },
  blocked: { color: "#92400e" },
  item: { paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: partnerColors.line },
  label: { fontSize: 14, fontWeight: "600", color: partnerColors.text },
  meta: { fontSize: 12, color: partnerColors.textSecondary, marginTop: 2 },
  warn: { fontSize: 12, color: "#92400e", marginTop: 2 },
  actions: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  reasonBox: { gap: 8, marginTop: 8 },
  input: { minHeight: 44, borderWidth: 1, borderColor: partnerColors.line, borderRadius: 12, paddingHorizontal: 12, color: partnerColors.text },
  btn: { minHeight: 44, paddingHorizontal: 14, justifyContent: "center", borderRadius: 12 },
  btnPrimary: { backgroundColor: partnerColors.primary },
  btnPrimaryText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  btnGhost: { borderWidth: 1, borderColor: partnerColors.line },
  btnGhostText: { color: partnerColors.text, fontWeight: "700", fontSize: 13 },
  btnDisabled: { opacity: 0.5 },
  error: { color: "#b91c1c", fontSize: 12, marginTop: 8 },
});
