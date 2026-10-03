import React, { useState } from "react";
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTheme } from "@/hooks/useTheme";
import { coreApi } from "@/services/core/api";

/**
 * Phase 10 §10 — the customer's side of a completed job (mirror of web BookingCompletion):
 * the server's quality verdict in plain words, the confirmation window with a "Confirm work is
 * done" action, a "Report an issue" sheet that opens a §11 case, and the warranty window.
 * Server truth; nothing is decided here, nothing internal is shown.
 */

/** UI labels for the server's category enum — descriptions of the choice, never data. */
const CATEGORY_LABEL: Record<string, string> = {
  QUALITY: "The quality of the work",
  INCOMPLETE: "The work was left unfinished",
  DAMAGE: "Something was damaged",
  BEHAVIOUR: "The professional's behaviour",
  NO_SHOW: "The professional did not show up",
  BILLING: "Billing or payment",
  OTHER: "Something else",
};

const CASE_STATE_LABEL: Record<string, string> = {
  CASE_CREATED: "Received",
  TRIAGE: "Being reviewed",
  ELIGIBILITY: "Checking what's covered",
  INVESTIGATION: "Being investigated",
  ACTION: "Being resolved",
  RESOLVED: "Resolved",
  REJECTED: "Closed — not approved",
  ESCALATED: "With our senior team",
};

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const dateOnly = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

export function BookingCompletionCard({ bookingId }: { bookingId: string }) {
  const { colors: c } = useTheme();
  const qc = useQueryClient();
  const [reportOpen, setReportOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");

  const q = useQuery({
    queryKey: ["bookings", "completion", bookingId],
    queryFn: () => coreApi.bookings.completion(bookingId),
    enabled: !!bookingId,
    staleTime: 15_000,
  });
  const casesQ = useQuery({
    queryKey: ["bookings", "cases", bookingId],
    queryFn: () => coreApi.bookings.cases(bookingId),
    enabled: !!bookingId && q.data?.completion != null,
    staleTime: 15_000,
  });

  const confirm = useMutation({
    mutationFn: () => coreApi.bookings.confirmCompletion(bookingId),
    onSettled: () => void qc.invalidateQueries({ queryKey: ["bookings", "completion", bookingId] }),
  });
  const report = useMutation({
    mutationFn: () =>
      coreApi.bookings.reportCase(bookingId, {
        category,
        ...(description.trim() ? { description: description.trim() } : {}),
      }),
    onSuccess: () => {
      setReportOpen(false);
      setCategory("");
      setDescription("");
    },
    onSettled: () =>
      void Promise.all([
        qc.invalidateQueries({ queryKey: ["bookings", "completion", bookingId] }),
        qc.invalidateQueries({ queryKey: ["bookings", "cases", bookingId] }),
      ]),
  });

  const v = q.data;
  if (!v || !v.completion) return null;
  const comp = v.completion;
  const cases = casesQ.data?.available ? casesQ.data.cases : [];
  const latestCase = cases[0] ?? null;
  const warrantyActive = v.warranty && v.warranty.state === "ACTIVE" ? v.warranty : null;

  return (
    <View testID="booking-completion">
      <Text style={[styles.sectionTitle, { color: c.text }]}>Job completion</Text>
      <View style={[styles.block, { backgroundColor: c.bg, borderColor: c.border }]}>
        {v.verdict ? (
          <View testID="booking-completion-verdict">
            <Text style={[styles.verdict, { color: c.text }]}>{v.verdict.label}</Text>
            {v.verdict.reasons.map((r) => (
              <Text key={r} style={[styles.small, { color: c.textSecondary }]}>
                • {r}
              </Text>
            ))}
          </View>
        ) : null}

        {comp.state === "PENDING_CUSTOMER" ? (
          <View style={styles.gap}>
            <Text style={{ color: c.text }}>
              Please confirm the work is done. If we don't hear from you, it will be confirmed automatically on{" "}
              <Text style={styles.bold}>{dateTime(comp.confirmBy)}</Text>.
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Confirm work is done"
              disabled={confirm.isPending}
              onPress={() => confirm.mutate()}
              style={[styles.btn, { backgroundColor: c.primary }, confirm.isPending && styles.btnDisabled]}
              testID="booking-confirm-completion"
            >
              <Text style={styles.btnText}>{confirm.isPending ? "Confirming..." : "Confirm work is done"}</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Report an issue with this job"
              onPress={() => setReportOpen(true)}
              style={[styles.btnOutline]}
              testID="booking-report-issue"
            >
              <Text style={styles.btnOutlineText}>Report an issue</Text>
            </Pressable>
            {confirm.isError ? (
              <Text style={styles.error} accessibilityRole="alert">
                {confirm.error instanceof Error ? confirm.error.message : "Could not confirm this booking. Please try again."}
              </Text>
            ) : null}
          </View>
        ) : null}

        {comp.state === "CONFIRMED" || comp.state === "AUTO_CONFIRMED" ? (
          <Text style={{ color: c.text }} testID="booking-completion-confirmed">
            ✓ {comp.state === "CONFIRMED" ? "You confirmed this service" : "This service was confirmed automatically"}
            {comp.resolvedAt ? ` on ${dateTime(comp.resolvedAt)}` : ""}.
          </Text>
        ) : null}

        {comp.state === "ISSUE_REPORTED" ? (
          <Text style={{ color: c.text }} testID="booking-completion-issue">
            ⚑ You reported an issue{latestCase ? ` (case ${latestCase.caseNumber})` : ""}.
            {latestCase ? ` Status: ${CASE_STATE_LABEL[latestCase.state] ?? latestCase.state}.` : " Our team is looking into it."}
          </Text>
        ) : null}

        {warrantyActive ? (
          <Text style={[styles.small, { color: c.textSecondary }]} testID="booking-warranty">
            Covered until {dateOnly(warrantyActive.expiresAt)}
          </Text>
        ) : null}
      </View>

      {cases.length > 0 ? (
        <View testID="booking-cases">
          <Text style={[styles.sectionTitle, { color: c.text }]}>Reported issues</Text>
          {cases.map((k) => (
            <View key={k.id} style={[styles.block, { backgroundColor: c.bg, borderColor: c.border }]} testID={`booking-case-${k.caseNumber}`}>
              <Text style={[styles.verdict, { color: c.text }]}>{CATEGORY_LABEL[k.category] ?? k.category}</Text>
              <Text style={[styles.small, { color: c.textSecondary }]}>
                Case {k.caseNumber} · {CASE_STATE_LABEL[k.state] ?? k.state} · reported {dateTime(k.createdAt)}
              </Text>
              {k.description ? <Text style={{ color: c.text }}>{k.description}</Text> : null}
              {k.timeline.map((t, i) => (
                <Text key={`${t.state}-${t.at}-${i}`} style={[styles.small, { color: c.textSecondary }]}>
                  {CASE_STATE_LABEL[t.state] ?? t.state} · {dateTime(t.at)}
                </Text>
              ))}
            </View>
          ))}
        </View>
      ) : null}

      <Modal visible={reportOpen} animationType="slide" transparent statusBarTranslucent onRequestClose={() => setReportOpen(false)}>
        {/* A statusBarTranslucent modal is not resized by the soft keyboard on Android (edge-to-edge), so
            the description field and "Report issue" sat under the keyboard. "padding" on both platforms:
            KeyboardAvoidingView adds only the overlap it measures, so a window that does resize gets 0. */}
        <KeyboardAvoidingView behavior="padding" style={styles.keyboardAvoider} testID="case-report-keyboard-avoider">
        <View style={styles.backdrop}>
          <View style={[styles.sheet, { backgroundColor: c.cardBg, borderColor: c.border }]}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <Text style={[styles.sheetTitle, { color: c.text }]}>Report an issue</Text>
              <Text style={[styles.small, { color: c.textSecondary, marginBottom: 8 }]}>What went wrong?</Text>
              {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
                <Pressable
                  key={value}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: category === value }}
                  accessibilityLabel={label}
                  onPress={() => setCategory(value)}
                  style={[styles.option, { borderColor: category === value ? c.primary : c.border }]}
                  testID={`case-category-${value}`}
                >
                  <Text style={{ color: c.text }}>
                    {category === value ? "◉" : "○"} {label}
                  </Text>
                </Pressable>
              ))}
              <Text style={[styles.small, { color: c.textSecondary, marginTop: 8, marginBottom: 4 }]}>
                Tell us what happened (optional)
              </Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                multiline
                numberOfLines={4}
                maxLength={2000}
                placeholder="What happened, and what would you like us to do?"
                placeholderTextColor={c.textSecondary}
                accessibilityLabel="Describe the issue"
                style={[styles.input, { borderColor: c.border, color: c.text }]}
                testID="case-description"
              />
              {report.isError ? (
                <Text style={styles.error} accessibilityRole="alert">
                  {report.error instanceof Error ? report.error.message : "Could not report this issue. Please try again."}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send the issue report"
                disabled={!category || report.isPending}
                onPress={() => report.mutate()}
                style={[styles.btn, { backgroundColor: c.primary }, (!category || report.isPending) && styles.btnDisabled]}
                testID="case-submit"
              >
                <Text style={styles.btnText}>{report.isPending ? "Sending..." : "Report issue"}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close without reporting"
                onPress={() => setReportOpen(false)}
                style={styles.btnOutline}
              >
                <Text style={styles.btnOutlineText}>Cancel</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  sectionTitle: { fontSize: 17, fontWeight: "700", marginTop: 16, marginBottom: 8 },
  block: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 6, marginBottom: 8 },
  verdict: { fontWeight: "600" },
  small: { fontSize: 12 },
  bold: { fontWeight: "700" },
  gap: { gap: 8 },
  btn: { minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, paddingVertical: 10, marginTop: 4 },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  btnOutline: { minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, paddingVertical: 10, marginTop: 4, borderWidth: 1, borderColor: "#fca5a5" },
  btnOutlineText: { color: "#b91c1c", fontWeight: "600", fontSize: 13 },
  error: { color: "#991b1b", fontSize: 12, marginTop: 4 },
  keyboardAvoider: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, padding: 20, maxHeight: "85%" },
  sheetTitle: { fontSize: 18, fontWeight: "700", marginBottom: 8 },
  option: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, padding: 10, minHeight: 88, textAlignVertical: "top", fontSize: 14 },
});
