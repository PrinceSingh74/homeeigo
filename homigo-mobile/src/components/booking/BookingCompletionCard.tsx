import React, { useState } from "react";
import { Image, KeyboardAvoidingView, Linking, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as ImagePicker from "expo-image-picker";
import { useTheme } from "@/hooks/useTheme";
import { Button } from "@/components/Button";
import { coreApi } from "@/services/core/api";
import { getApiBaseUrl } from "@/lib/api-config";
import { useAuthStore } from "@/stores/auth-store";
import {
  CLOSED_CASE_STATES,
  casePhotoError,
  casePhotoPart,
  casePhotoPermissionMessage,
  reportDecision,
  reportRefusal,
  type CasePhotoPart,
  type ReportDecision,
} from "@/lib/case-report";

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

const ACTION_LABEL: Record<string, string> = {
  REWORK: "A follow-up visit was arranged",
  REFUND: "A refund was issued",
  INSPECTION: "An inspection visit was arranged",
  REJECT: "No action was taken on this issue",
  NONE: "Closed with no further action",
};

const dateTime = (iso: string) =>
  new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const dateOnly = (iso: string) => new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });

type Cover = { state: string; startsAt: string; expiresAt: string } | null;
type CoverLine = { tone: "active" | "ended" | "none"; glyph: string; title: string; detail: string | null };

/**
 * Every cover state the API returns (ACTIVE | EXPIRED | VOID | none), in words. An ACTIVE row whose
 * end date has passed reads as ended — the dates are the server's; only "has that date passed" is
 * evaluated here. Mirror of web describeCover.
 */
export function describeCover(w: Cover, now: number = Date.now()): CoverLine {
  if (!w) return { tone: "none", glyph: "–", title: "No cover is active on this booking", detail: null };
  const started = `Started ${dateOnly(w.startsAt)}`;
  if (w.state === "VOID") return { tone: "none", glyph: "–", title: "Cover no longer applies to this booking", detail: null };
  const ended = w.state === "EXPIRED" || new Date(w.expiresAt).getTime() <= now;
  if (ended) return { tone: "ended", glyph: "–", title: `Cover ended on ${dateOnly(w.expiresAt)}`, detail: started };
  if (w.state === "ACTIVE") return { tone: "active", glyph: "✓", title: `Covered until ${dateOnly(w.expiresAt)}`, detail: started };
  // A state this client does not know: show the server's dates and make no claim about them.
  return { tone: "none", glyph: "–", title: `Cover period: ${dateOnly(w.startsAt)} to ${dateOnly(w.expiresAt)}`, detail: null };
}

type Props = {
  bookingId: string;
  /** Opens another booking's detail (a case's follow-up visit). Without it the visit is stated, not linked. */
  onOpenFollowUp?: (bookingId: string) => void;
};

export function BookingCompletionCard({ bookingId, onOpenFollowUp }: Props) {
  const { colors: c } = useTheme();
  const qc = useQueryClient();
  const [reportOpen, setReportOpen] = useState(false);
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  /** The server's refusal for this booking: shown in the sheet, and — when final — on the card. */
  const [refusal, setRefusal] = useState<{ message: string; final: boolean } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const q = useQuery({
    queryKey: ["bookings", "completion", bookingId],
    queryFn: () => coreApi.bookings.completion(bookingId),
    enabled: !!bookingId,
    staleTime: 15_000,
  });
  const casesQ = useQuery({
    queryKey: ["bookings", "cases", bookingId],
    queryFn: () => coreApi.bookings.cases(bookingId),
    // Every completed booking, not only one with an issue: `report` says whether one can be raised.
    enabled: !!bookingId && (q.data?.completion != null || q.data?.bookingStatus === "COMPLETED"),
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
    onSuccess: (r) => {
      // A replay means a case is already open on this booking; the server did not open a second one.
      setNotice(
        r.replayed
          ? "You already have an open issue on this booking — it's shown below."
          : "Issue reported — our team will look into it. You can now add photos or more details to this case under Reported issues.",
      );
      setRefusal(null);
      setReportOpen(false);
      setCategory("");
      setDescription("");
    },
    onError: (e) => {
      const next = reportRefusal((e as { code?: string } | null)?.code, e instanceof Error ? e.message : null);
      setRefusal(next);
      if (next.final) setReportOpen(false);
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
  const cover = describeCover(v.warranty);
  const confirmed = comp.state === "CONFIRMED" || comp.state === "AUTO_CONFIRMED";
  // The server's `report` decides; without it (older backend) the action is offered and its refusal shown.
  // While the first answer is still loading nothing is offered, so a button never appears and vanishes.
  const decision: ReportDecision = casesQ.isLoading
    ? { kind: "none" }
    : reportDecision({ report: casesQ.data?.report, completionState: comp.state, latestCaseState: latestCase?.state, refusal });
  const openCase = decision.kind === "open_case" ? (cases.find((k) => k.id === decision.caseId) ?? null) : null;
  const openReport = () => {
    setRefusal(null);
    setNotice(null);
    setReportOpen(true);
  };
  const outlineBtn = [styles.btnOutline, { borderColor: c.border }];
  const reportButton =
    decision.kind === "offer" ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${decision.label} with this job`}
        onPress={openReport}
        style={outlineBtn}
        testID="booking-report-issue"
      >
        <Text style={[styles.btnOutlineText, { color: c.text }]}>{decision.label}</Text>
      </Pressable>
    ) : null;

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
              disabled={confirm.isPending || !comp.canConfirm}
              accessibilityState={{ disabled: confirm.isPending || !comp.canConfirm, busy: confirm.isPending }}
              onPress={() => confirm.mutate()}
              style={[styles.btn, styles.btnPrimary, { backgroundColor: c.primary }, (confirm.isPending || !comp.canConfirm) && styles.btnDisabled]}
              testID="booking-confirm-completion"
            >
              <Text style={styles.btnText}>{confirm.isPending ? "Confirming..." : "Confirm work is done"}</Text>
            </Pressable>
            {reportButton}
            {confirm.isError ? (
              <Text style={styles.error} accessibilityRole="alert">
                {confirm.error instanceof Error ? confirm.error.message : "Could not confirm this booking. Please try again."}
              </Text>
            ) : null}
          </View>
        ) : null}

        {confirmed ? (
          <View style={styles.gap}>
            <Text style={{ color: c.text }} testID="booking-completion-confirmed">
              ✓ {comp.state === "CONFIRMED" ? "You confirmed this service" : "This service was confirmed automatically"}
              {comp.resolvedAt ? ` on ${dateTime(comp.resolvedAt)}` : ""}.
            </Text>
            {reportButton ? (
              <>
                <Text style={[styles.small, { color: c.textSecondary }]}>Noticed a problem since then? You can still tell us.</Text>
                {reportButton}
              </>
            ) : null}
          </View>
        ) : null}

        {comp.state === "ISSUE_REPORTED" ? (
          <View style={styles.gap}>
            <Text style={{ color: c.text }} testID="booking-completion-issue">
              ⚑ You reported an issue{latestCase ? ` (case ${latestCase.caseNumber})` : ""}.
              {latestCase ? ` Status: ${CASE_STATE_LABEL[latestCase.state] ?? latestCase.state}.` : " Our team is looking into it."}
            </Text>
            {reportButton}
          </View>
        ) : null}

        {decision.kind === "open_case" ? (
          <Text
            style={[styles.refused, { color: c.text, borderColor: c.border, backgroundColor: c.cardBg }]}
            testID="booking-report-open-case"
          >
            ⓘ {comp.state === "ISSUE_REPORTED" ? "Your issue is still open" : `You have an open issue on this booking${openCase ? ` (case ${openCase.caseNumber})` : ""}`}
            . Its progress is shown under Reported issues below.
          </Text>
        ) : null}

        {notice && decision.kind !== "reason" ? (
          <Text style={[styles.small, { color: c.text }]} accessibilityLiveRegion="polite" testID="booking-report-notice">
            {notice}
          </Text>
        ) : null}

        {decision.kind === "reason" ? (
          <Text
            style={[styles.refused, { color: c.text, borderColor: c.border, backgroundColor: c.cardBg }]}
            accessibilityLiveRegion="polite"
            testID="booking-report-refused"
          >
            ⓘ {decision.message}
          </Text>
        ) : null}

        <View style={[styles.cover, { borderTopColor: c.border }]} testID="booking-warranty" accessible accessibilityLabel={[cover.title, cover.detail].filter(Boolean).join(". ")}>
          <Text style={[cover.tone === "active" ? styles.verdict : null, { color: cover.tone === "active" ? c.text : c.textSecondary }]}>
            {cover.glyph} {cover.title}
          </Text>
          {cover.detail ? <Text style={[styles.small, { color: c.textSecondary }]}>{cover.detail}</Text> : null}
        </View>
      </View>

      {cases.length > 0 ? (
        <View testID="booking-cases">
          <Text style={[styles.sectionTitle, { color: c.text }]}>Reported issues</Text>
          {cases.map((k) => {
            const action = k.resolution?.action ? ACTION_LABEL[String(k.resolution.action)] ?? null : null;
            const refund = typeof k.resolution?.refundPaise === "number" && k.resolution.refundPaise > 0 ? k.resolution.refundPaise : null;
            const followUpId = k.resolution?.followUpBookingId ?? null;
            return (
              <View key={k.id} style={[styles.block, { backgroundColor: c.bg, borderColor: c.border }]} testID={`booking-case-${k.caseNumber}`}>
                <Text style={[styles.verdict, { color: c.text }]}>{CATEGORY_LABEL[k.category] ?? k.category}</Text>
                <Text style={[styles.small, { color: c.textSecondary }]}>
                  Case {k.caseNumber} · {CASE_STATE_LABEL[k.state] ?? k.state} · reported {dateTime(k.createdAt)}
                </Text>
                {k.description ? <Text style={{ color: c.text }}>{k.description}</Text> : null}
                {action ? (
                  <Text style={{ color: c.text }} testID="booking-case-resolution">
                    {action}
                    {refund ? ` — ₹${(refund / 100).toLocaleString("en-IN")}` : ""}.
                  </Text>
                ) : null}
                {followUpId ? (
                  onOpenFollowUp ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Follow-up visit booked. View the follow-up booking"
                      onPress={() => onOpenFollowUp(followUpId)}
                      style={[styles.followUp, { borderColor: c.border, backgroundColor: c.cardBg }]}
                      testID="booking-case-follow-up"
                    >
                      <View style={styles.followUpText}>
                        <Text style={[styles.verdict, { color: c.text }]}>Follow-up visit booked</Text>
                        <Text style={[styles.small, { color: c.textSecondary }]}>View the follow-up booking</Text>
                      </View>
                      <Text style={[styles.chevron, { color: c.textSecondary }]}>›</Text>
                    </Pressable>
                  ) : (
                    <View style={[styles.followUp, { borderColor: c.border, backgroundColor: c.cardBg }]} testID="booking-case-follow-up">
                      <View style={styles.followUpText}>
                        <Text style={[styles.verdict, { color: c.text }]}>Follow-up visit booked</Text>
                        <Text style={[styles.small, { color: c.textSecondary }]}>You'll find it in My Bookings.</Text>
                      </View>
                    </View>
                  )
                ) : null}
                <CaseEvidence bookingId={bookingId} caseId={k.id} caseNumber={k.caseNumber} evidence={k.evidence ?? []} c={c} />
                {!k.closedAt && !CLOSED_CASE_STATES.has(k.state) ? (
                  <CaseActions bookingId={bookingId} caseId={k.id} caseNumber={k.caseNumber} c={c} />
                ) : null}
                {k.timeline.map((t, i) => (
                  <Text key={`${t.state}-${t.at}-${i}`} style={[styles.small, { color: c.textSecondary }]}>
                    {CASE_STATE_LABEL[t.state] ?? t.state} · {dateTime(t.at)}
                  </Text>
                ))}
              </View>
            );
          })}
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
              {refusal && !refusal.final ? (
                <Text style={styles.error} accessibilityRole="alert" testID="case-error">
                  {refusal.message}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send the issue report"
                disabled={!category || report.isPending}
                onPress={() => {
                  setRefusal(null);
                  report.mutate();
                }}
                style={[styles.btn, { backgroundColor: c.primary }, (!category || report.isPending) && styles.btnDisabled]}
                testID="case-submit"
              >
                <Text style={styles.btnText}>{report.isPending ? "Sending..." : "Report issue"}</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Close without reporting"
                onPress={() => setReportOpen(false)}
                style={outlineBtn}
              >
                <Text style={[styles.btnOutlineText, { color: c.text }]}>Cancel</Text>
              </Pressable>
            </ScrollView>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

type CaseEvidenceItem = { id: number; kind: string; note: string | null; hasStoredMedia?: boolean; createdAt: string };
type Colors = ReturnType<typeof useTheme>["colors"];

/** The server's refusals for POST /:id/cases/:caseId/evidence, in the customer's words (as on web). */
const NOTE_REFUSAL: Record<string, string> = {
  CASE_CLOSED: "This case is closed, so it can't take more details.",
  CASE_NOT_FOUND: "We couldn't find this case. Please reopen the booking and try again.",
  EVIDENCE_LIMIT: "This case already has the maximum number of notes and photos.",
  EVIDENCE_INVALID: "That note couldn't be added. Please check it and try again.",
  CASES_UNAVAILABLE: "Issue reporting isn't available right now. Please try again in a little while.",
};

/**
 * What the customer can add to their own OPEN case: more details (a NOTE) or one photo at a time,
 * taken now or chosen from the library. The server decides whether the case still accepts either.
 * The camera permission is asked for only when "Take a photo" is tapped; choosing from the library
 * uses the system photo picker, which shows only what the customer selects and needs no permission.
 */
function CaseActions({ bookingId, caseId, caseNumber, c }: { bookingId: string; caseId: string; caseNumber: string; c: Colors }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<"note" | "photo" | null>(null);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string; settings?: boolean } | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["bookings", "cases", bookingId] });

  const addNote = useMutation({
    mutationFn: () => coreApi.bookings.addCaseNote(bookingId, caseId, note.trim()),
    onSuccess: () => {
      setNote("");
      setMode(null);
      setMessage({ tone: "ok", text: "Added to your case." });
    },
    onError: (e) => {
      const code = (e as { code?: string } | null)?.code;
      setMessage({ tone: "error", text: (code && NOTE_REFUSAL[code]) || (e instanceof Error && e.message ? e.message : "Could not add this note. Please try again.") });
    },
    onSettled: refresh,
  });

  const addPhoto = useMutation({
    mutationFn: (file: CasePhotoPart) => coreApi.bookings.addCasePhoto(bookingId, caseId, file),
    onSuccess: () => {
      setMode(null);
      setMessage({ tone: "ok", text: "Photo added to your case." });
    },
    onError: (e) => {
      const code = (e as { code?: string } | null)?.code;
      // Connection failures carry their own sentence; server refusals are mapped from their code.
      const text = code === "TIMEOUT" || code === "NETWORK_ERROR" ? (e as Error).message : casePhotoError(code);
      setMessage({ tone: "error", text });
    },
    // The new photo shows up in the thumbnails once the case is refetched.
    onSettled: refresh,
  });

  async function pick(source: "camera" | "library") {
    if (addPhoto.isPending) return;
    setMessage(null);
    try {
      if (source === "camera") {
        const permission = await ImagePicker.requestCameraPermissionsAsync();
        if (!permission.granted) {
          setMessage({ tone: "error", text: casePhotoPermissionMessage("camera"), settings: true });
          return;
        }
      }
      // quality 0.7 re-encodes the photo, which keeps a typical phone picture well under the 8 MB limit.
      const options: ImagePicker.ImagePickerOptions = { mediaTypes: ["images"], quality: 0.7, exif: false, allowsMultipleSelection: false };
      const result = source === "camera" ? await ImagePicker.launchCameraAsync(options) : await ImagePicker.launchImageLibraryAsync(options);
      const asset = result.canceled ? undefined : result.assets?.[0];
      if (!asset) return;
      const part = casePhotoPart({ uri: asset.uri, mimeType: asset.mimeType, fileName: asset.fileName, fileSize: asset.fileSize });
      if (!part.ok) {
        setMessage({ tone: "error", text: part.message });
        return;
      }
      addPhoto.mutate(part.file);
    } catch {
      setMessage({
        tone: "error",
        text: source === "camera" ? "The camera couldn't be opened. Choose a photo from your library instead." : casePhotoPermissionMessage("library"),
        settings: source === "library",
      });
    }
  }

  const busy = addNote.isPending || addPhoto.isPending;

  return (
    <View style={[styles.evidence, { borderTopColor: c.border }]} testID="booking-case-actions">
      {mode === null ? (
        <View style={styles.actionRow}>
          <Button
            title="Add more details"
            variant="secondary"
            size="sm"
            onPress={() => {
              setMessage(null);
              setMode("note");
            }}
            accessibilityLabel={`Add more details to case ${caseNumber}`}
          />
          <Button
            title="Add a photo"
            variant="secondary"
            size="sm"
            onPress={() => {
              setMessage(null);
              setMode("photo");
            }}
            accessibilityLabel={`Add a photo to case ${caseNumber}`}
          />
        </View>
      ) : null}

      {mode === "note" ? (
        <View style={styles.gap}>
          <Text style={[styles.verdict, { color: c.text }]}>Add more details to case {caseNumber}</Text>
          <TextInput
            value={note}
            onChangeText={setNote}
            multiline
            numberOfLines={3}
            maxLength={2000}
            editable={!addNote.isPending}
            placeholder="Anything else our team should know?"
            placeholderTextColor={c.textSecondary}
            accessibilityLabel={`More details for case ${caseNumber}`}
            style={[styles.input, { borderColor: c.border, color: c.text }]}
            testID="booking-case-note"
          />
          <View style={styles.actionRow}>
            <Button
              title="Send"
              size="sm"
              onPress={() => {
                setMessage(null);
                addNote.mutate();
              }}
              disabled={!note.trim()}
              loading={addNote.isPending}
              accessibilityLabel={`Send these details for case ${caseNumber}`}
            />
            <Button title="Cancel" variant="secondary" size="sm" onPress={() => setMode(null)} disabled={addNote.isPending} accessibilityLabel="Cancel adding details" />
          </View>
        </View>
      ) : null}

      {mode === "photo" ? (
        <View style={styles.gap}>
          <Text style={[styles.verdict, { color: c.text }]}>Add a photo to case {caseNumber}</Text>
          <Text style={[styles.small, { color: c.textSecondary }]}>One photo at a time — JPG, PNG or WEBP, up to 8 MB.</Text>
          {addPhoto.isPending ? (
            <Text style={[styles.small, { color: c.text }]} accessibilityLiveRegion="polite" testID="booking-case-photo-uploading">
              Uploading photo…
            </Text>
          ) : null}
          <View style={styles.actionRow}>
            <Button
              title="Take a photo"
              variant="secondary"
              size="sm"
              onPress={() => void pick("camera")}
              disabled={busy}
              accessibilityLabel={`Take a photo for case ${caseNumber}`}
            />
            <Button
              title="Choose from library"
              variant="secondary"
              size="sm"
              onPress={() => void pick("library")}
              disabled={busy}
              loading={addPhoto.isPending}
              accessibilityLabel={`Choose a photo from your library for case ${caseNumber}`}
            />
            <Button title="Cancel" variant="secondary" size="sm" onPress={() => setMode(null)} disabled={busy} accessibilityLabel="Cancel adding a photo" />
          </View>
        </View>
      ) : null}

      {message ? (
        <View style={styles.gap}>
          <Text
            style={[styles.small, { color: message.tone === "error" ? c.error : c.text }]}
            accessibilityRole={message.tone === "error" ? "alert" : undefined}
            accessibilityLiveRegion="polite"
            testID={message.tone === "error" ? "booking-case-action-error" : "booking-case-action-done"}
          >
            {message.tone === "error" ? "⚠ " : "✓ "}
            {message.text}
          </Text>
          {message.settings ? (
            <View style={styles.actionRow}>
              <Button title="Open settings" variant="secondary" size="sm" onPress={() => void Linking.openSettings()} accessibilityLabel="Open this app's settings" />
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

/** What the customer sent on a case: their notes, and their stored photos as thumbnails. */
function CaseEvidence({ bookingId, caseId, caseNumber, evidence, c }: { bookingId: string; caseId: string; caseNumber: string; evidence: CaseEvidenceItem[]; c: Colors }) {
  const notes = evidence.filter((e) => e.kind === "NOTE" && e.note);
  const photos = evidence.filter((e) => e.kind !== "NOTE" && e.hasStoredMedia === true);
  // Evidence with no stored photo to show (a job photo reference, or media kept elsewhere).
  const others = evidence.filter((e) => e.kind !== "NOTE" && e.hasStoredMedia !== true).length;
  if (notes.length === 0 && photos.length === 0 && others === 0) return null;
  return (
    <View style={[styles.evidence, { borderTopColor: c.border }]} testID="booking-case-evidence">
      <Text style={[styles.small, styles.bold, { color: c.textSecondary }]}>What you sent us</Text>
      {notes.map((e) => (
        <Text key={e.id} style={{ color: c.text }}>
          {e.note} <Text style={[styles.small, { color: c.textSecondary }]}>· {dateTime(e.createdAt)}</Text>
        </Text>
      ))}
      {others > 0 ? (
        <Text style={[styles.small, { color: c.textSecondary }]}>{others === 1 ? "1 other attachment" : `${others} other attachments`}</Text>
      ) : null}
      {photos.length > 0 ? (
        <View style={styles.photoRow} testID="booking-case-photos">
          {photos.map((e, i) => (
            <CasePhoto
              key={e.id}
              bookingId={bookingId}
              caseId={caseId}
              evidenceId={e.id}
              label={`Photo ${i + 1} of ${photos.length} you added to case ${caseNumber}, ${dateTime(e.createdAt)}`}
              c={c}
            />
          ))}
        </View>
      ) : null}
    </View>
  );
}

/**
 * One stored photo, from GET /:id/cases/:caseId/evidence/:evidenceId/media. The route is private,
 * so the image request carries the customer's bearer token; a bare uri would be refused.
 */
function CasePhoto({ bookingId, caseId, evidenceId, label, c }: { bookingId: string; caseId: string; evidenceId: number; label: string; c: Colors }) {
  const token = useAuthStore((s) => s.accessToken);
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const frame = [styles.photo, { borderColor: c.border, backgroundColor: c.cardBg }];

  if (!token || state === "failed") {
    return (
      <View style={frame} accessible accessibilityRole="image" accessibilityLabel={`${label}. Photo unavailable`} testID="booking-case-photo-unavailable">
        <Text style={[styles.photoNote, { color: c.textSecondary }]}>Photo unavailable</Text>
      </View>
    );
  }
  return (
    <View style={frame}>
      <Image
        source={{
          uri: `${getApiBaseUrl()}/api/bookings/${bookingId}/cases/${encodeURIComponent(caseId)}/evidence/${evidenceId}/media`,
          headers: { Authorization: `Bearer ${token}` },
        }}
        style={styles.photoImage}
        resizeMode="cover"
        accessible
        accessibilityRole="image"
        accessibilityLabel={label}
        onLoad={() => setState("ready")}
        onError={() => setState("failed")}
        testID="booking-case-photo"
      />
      {state === "loading" ? (
        <View style={[styles.photoOverlay, { backgroundColor: c.cardBg }]} accessibilityLiveRegion="polite">
          <Text style={[styles.photoNote, { color: c.textSecondary }]}>Loading photo…</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  evidence: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, marginTop: 2, gap: 4 },
  photoRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  actionRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  photo: { width: 88, height: 88, borderRadius: 12, borderWidth: 1, overflow: "hidden", alignItems: "center", justifyContent: "center" },
  photoImage: { width: "100%", height: "100%" },
  photoOverlay: { ...StyleSheet.absoluteFillObject, alignItems: "center", justifyContent: "center", padding: 4 },
  photoNote: { fontSize: 11, textAlign: "center" },
  sectionTitle: { fontSize: 17, fontWeight: "700", marginTop: 16, marginBottom: 8 },
  block: { borderWidth: 1, borderRadius: 16, padding: 12, gap: 6, marginBottom: 8 },
  verdict: { fontWeight: "600" },
  small: { fontSize: 12 },
  bold: { fontWeight: "700" },
  gap: { gap: 8 },
  btn: { minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, paddingVertical: 10, marginTop: 4 },
  btnDisabled: { opacity: 0.5 },
  btnText: { color: "#fff", fontWeight: "600", fontSize: 13 },
  btnPrimary: { minHeight: 48 },
  btnOutline: { minHeight: 44, borderRadius: 12, alignItems: "center", justifyContent: "center", paddingHorizontal: 16, paddingVertical: 10, marginTop: 4, borderWidth: 1 },
  btnOutlineText: { fontWeight: "600", fontSize: 13 },
  refused: { fontSize: 13, borderWidth: 1, borderRadius: 12, padding: 10, overflow: "hidden" },
  cover: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8, marginTop: 2, gap: 2 },
  followUp: { minHeight: 48, flexDirection: "row", alignItems: "center", borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 8, marginVertical: 4 },
  followUpText: { flex: 1, gap: 2 },
  chevron: { fontSize: 22, marginLeft: 8 },
  error: { color: "#991b1b", fontSize: 12, marginTop: 4 },
  keyboardAvoider: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, borderWidth: 1, padding: 20, maxHeight: "85%" },
  sheetTitle: { fontSize: 18, fontWeight: "700", marginBottom: 8 },
  option: { borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 6 },
  input: { borderWidth: 1, borderRadius: 12, padding: 10, minHeight: 88, textAlignVertical: "top", fontSize: 14 },
});
