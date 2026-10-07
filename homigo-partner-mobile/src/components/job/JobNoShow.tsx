import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, CheckCircle2, Clock, UserX } from "lucide-react-native";
import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Collapsible } from "@/components/job/Collapsible";
import type { PickedEvidence } from "@/components/job/PhotoPicker";
import { Banner, Button, Card, formatRupees, Sheet, T } from "@/components/ui";
import { jobActionsKey, refreshJob } from "@/hooks/job/use-job-lifecycle";
import { failureSentence } from "@/lib/job-screen";
import { doorPhotoUploadId, noShowResultView, noShowView } from "@/lib/no-show";
import { partnerApi } from "@/services/partner-api";
import { color, space } from "@/theme/tokens";
import type { NoShowPreview, NoShowReportResult } from "@/types/partner";

/**
 * "Customer not available?" — after arrival and before start (tracker P0-7c). Ported from partner
 * web's `NoShowSection`.
 *
 * Secondary on purpose: collapsed until the partner asks for it, so it never competes with Start.
 * Everything that matters is the server's — `preview` is the `noShow` block of
 * `GET /api/bookings/:id/actions`: whether the wait has been served, whether a fee applies, and the
 * sentence that explains it. This component only counts the minutes down between two answers
 * (`noShowView`) and never opens the report on the phone's clock: at zero it asks the server again.
 *
 * The door photo is ARRIVAL evidence sent through the same upload as every other job photo; the
 * server decides whether it counts. No photo control is shown when a photo could not change the
 * answer (the arrival was vouched for, the customer gave the PIN, nothing was paid in advance).
 */
export function JobNoShow({
  bookingId,
  preview,
  fetchedAt,
  refreshing,
  onRefresh,
  pickPhoto,
}: {
  bookingId: string;
  /** The server's answer; null once the report is no longer on offer (started, reported, closed). */
  preview: NoShowPreview | null;
  /** When that answer arrived (the query's `dataUpdatedAt`) — the countdown runs from here. */
  fetchedAt: number;
  refreshing: boolean;
  /** Ask the server again (the countdown reached zero). */
  onRefresh: () => void;
  pickPhoto: (ask: { title: string; note?: string }) => Promise<PickedEvidence | null>;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [confirming, setConfirming] = useState(false);
  // The server's answer to the report, kept in the query cache by booking: leaving the job and coming
  // back still shows what was recorded and why a fee was or was not taken.
  const resultKey = ["partner", "no-show-result", bookingId];
  const result = useQuery<NoShowReportResult | null>({ queryKey: resultKey, queryFn: () => null, enabled: false, staleTime: Infinity, gcTime: Infinity }).data ?? null;
  const [reportError, setReportError] = useState<string | null>(null);

  const view = preview ? noShowView(preview, fetchedAt, now) : null;
  const waiting = open && preview != null && !preview.canReport;

  // The countdown: a clock tick while the section is open and the server has not opened the report.
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => setNow(Date.now()), 5_000);
    return () => clearInterval(timer);
  }, [waiting]);

  // At zero the server is asked again (`shouldRefetch` holds NO_SHOW_REFETCH_FLOOR_MS between asks).
  const shouldRefetch = waiting && view?.shouldRefetch === true && !refreshing;
  useEffect(() => {
    if (shouldRefetch) onRefresh();
  }, [shouldRefetch, onRefresh]);

  const upload = useMutation({
    mutationFn: (photo: PickedEvidence) =>
      partnerApi.uploadEvidence(bookingId, { stage: "ARRIVAL", mediaUrl: photo.dataUrl, clientUploadId: doorPhotoUploadId(photo.pickedAtMs) }),
    // The server decides whether this photo counts; read its answer again either way.
    onSettled: () => Promise.all([qc.invalidateQueries({ queryKey: jobActionsKey(bookingId) }), qc.invalidateQueries({ queryKey: ["partner", "job-evidence", bookingId] })]),
  });

  const report = useMutation({
    mutationFn: () => partnerApi.reportCustomerNoShow(bookingId),
    onMutate: () => setReportError(null),
    onSuccess: (data) => {
      setConfirming(false);
      qc.setQueryData(resultKey, data);
    },
    onError: (err) => {
      // BEFORE_APPOINTMENT, GRACE_NOT_ELAPSED, NO_ARRIVAL_EVIDENCE, …: the server's own sentence.
      setReportError(failureSentence(err));
      setConfirming(false);
    },
    // The job is closed (or the server's preview changed): read everything again before settling.
    onSettled: () => refreshJob(qc, bookingId),
  });

  async function addDoorPhoto() {
    const photo = await pickPhoto({ title: "Add door photo", note: "Take a photo at the customer's door. It is saved with this job." });
    if (photo) upload.mutate(photo);
  }

  if (result) {
    const shown = noShowResultView(result);
    return (
      <Card testID="no-show-section">
        <View testID="no-show-result" accessible accessibilityRole="alert" accessibilityLiveRegion="polite" style={styles.result}>
          <View style={styles.line}>
            <UserX color={color.leaf} size={20} />
            <T kind="bodyStrong" style={styles.flex}>
              {shown.message || "Reported"}
            </T>
          </View>
          {shown.feeRecorded !== null ? (
            <T kind="body" numeric testID="no-show-result-fee">
              {`Fee recorded: ${formatRupees(shown.feeRecorded)}`}
            </T>
          ) : null}
          {shown.feeNote ? (
            <T kind="small" testID="no-show-result-note">
              {shown.feeNote}
            </T>
          ) : null}
        </View>
      </Card>
    );
  }

  if (!preview || !view) return null;

  const failedUpload = upload.isError ? upload.variables : undefined;

  return (
    <>
      <Collapsible
        title="Customer not available?"
        icon={UserX}
        summary={open ? null : view.waitLabel}
        open={open}
        onToggle={(next) => {
          setNow(Date.now());
          setOpen(next);
        }}
        testID="no-show-section"
        toggleTestID="no-show-toggle"
      >
        <View style={styles.line} testID="no-show-wait">
          <Clock color={color.slate} size={18} />
          <T kind="bodyStrong" numeric style={styles.flex}>
            {view.waitLabel}
          </T>
        </View>

        <T kind="body" tone="slate" testID="no-show-message">
          {view.message}
        </T>

        {view.doorPhoto === "NOT_ASKED" ? null : (
          <View testID="no-show-door-photo" style={styles.block}>
            {view.doorPhoto === "ADDED" ? (
              <View style={styles.line} accessible accessibilityLabel="Door photo added">
                <CheckCircle2 color={color.success} size={20} />
                <T kind="bodyStrong" tone="success" style={styles.flex}>
                  Door photo added
                </T>
              </View>
            ) : (
              <Button label="Add door photo" icon={Camera} variant="secondary" onPress={() => void addDoorPhoto()} loading={upload.isPending} testID="no-show-door-photo-add" />
            )}
            {failedUpload ? (
              <Banner
                tone="danger"
                testID="no-show-door-photo-error"
                message={failureSentence(upload.error, "The photo could not be uploaded.")}
                action={<Button label="Try again" variant="secondary" onPress={() => upload.mutate(failedUpload)} loading={upload.isPending} />}
              />
            ) : null}
          </View>
        )}

        <Button
          label="Report customer not available"
          variant="danger"
          onPress={() => {
            setReportError(null);
            // The sheet repeats the server's sentence: ask for it again now, so it is not a 15-second-old one.
            onRefresh();
            setConfirming(true);
          }}
          disabled={!view.canReport || report.isPending}
          hint={view.canReport ? null : view.waitLabel}
          testID="no-show-report"
        />

        {reportError ? <Banner tone="danger" message={reportError} testID="no-show-error" /> : null}
      </Collapsible>

      <Sheet
        visible={confirming}
        onClose={() => setConfirming(false)}
        title="Report customer not available?"
        dismissable={!report.isPending}
        testID="no-show-confirm"
        footer={
          <>
            <Button label="Report customer not available" variant="danger" onPress={() => report.mutate()} loading={report.isPending} testID="no-show-confirm-submit" />
            <Button label="Go back" variant="quiet" onPress={() => setConfirming(false)} disabled={report.isPending} testID="no-show-confirm-cancel" />
          </>
        }
      >
        {/* The server's sentence again: what this report will do, in its words. */}
        <T kind="body" testID="no-show-confirm-message">
          {view.message}
        </T>
        <T kind="small">This closes the job. It cannot be undone from the app.</T>
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  line: { flexDirection: "row", alignItems: "center", gap: space.sm },
  block: { gap: space.sm },
  result: { gap: space.xs },
});
