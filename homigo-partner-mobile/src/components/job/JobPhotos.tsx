import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Camera, ImageOff, X } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Image, Modal, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Collapsible } from "@/components/job/Collapsible";
import { PanelEmpty, PanelError, PanelLoading, SubHeading } from "@/components/job/parts";
import type { PickedEvidence } from "@/components/job/PhotoPicker";
import { Banner, Button, T } from "@/components/ui";
import { jobActionsKey } from "@/hooks/job/use-job-lifecycle";
import { EVIDENCE_MAX_PHOTOS_PER_UPLOAD, evidenceUploadId, type EvidenceImageSource } from "@/lib/evidence-photo";
import { formatDateTime } from "@/lib/format";
import { failureSentence, PHOTO_STAGE_LABEL, photosByStage, type CompletionProof, type PhotoStage } from "@/lib/job-screen";
import { partnerApi } from "@/services/partner-api";
import { useAuthStore } from "@/stores/auth-store";
import { color, radius, space, touch } from "@/theme/tokens";
import type { JobEvidenceItem } from "@/types/partner";

type EvidenceQuery = { data: JobEvidenceItem[] | undefined; isLoading: boolean; isError: boolean; error: unknown; isFetching: boolean; refetch: () => unknown };

type Upload = { stage: Exclude<PhotoStage, "COMPLETION">; photo: PickedEvidence };

/**
 * The job's photos by stage — Arrival, Start, Completion — as thumbnails that open full screen.
 *
 * Server rules this implements (tracker P0-7 / P0-7b):
 *  - a photo is the image itself, checked on the phone first (`checkEvidencePhoto`, inside the
 *    picker) and sent as a data URL; the server's own sentence is shown for a duplicate, a full
 *    stage, a job that is no longer active, an oversized or an invalid photo;
 *  - a stored photo is readable only by the signed-in partner: thumbnails load through
 *    `partnerApi.evidenceImageSource` (bearer header on API paths, never sent to another host);
 *  - an upload is idempotent on its id: "Try again" re-sends the SAME pick under the SAME id;
 *  - Arrival and Start photos are uploaded when picked; the Completion photo is only staged here
 *    and travels once, with the completion itself.
 */
export function JobPhotos({
  bookingId,
  evidence,
  openStages,
  pickPhoto,
  staged,
  onAddCompletionPhoto,
  onRemoveStaged,
  proof,
  defaultOpen,
}: {
  bookingId: string;
  evidence: EvidenceQuery;
  /** Stages that take a new photo now (`photoStagesOpen` of the server's stage). */
  openStages: readonly PhotoStage[];
  pickPhoto: (ask: { title: string; note?: string }) => Promise<PickedEvidence | null>;
  /** Completion photos picked and not yet sent. */
  staged: readonly PickedEvidence[];
  onAddCompletionPhoto: () => void;
  onRemoveStaged: (index: number) => void;
  proof: CompletionProof;
  defaultOpen?: boolean;
}) {
  const qc = useQueryClient();
  const [viewing, setViewing] = useState<{ source: EvidenceImageSource; label: string } | null>(null);

  const upload = useMutation({
    mutationFn: ({ stage, photo }: Upload) =>
      partnerApi.uploadEvidence(bookingId, { stage, mediaUrl: photo.dataUrl, clientUploadId: evidenceUploadId(stage, photo.pickedAtMs) }),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["partner", "job-evidence", bookingId] }),
        // A photo can change what the server offers next (the no-show preview reads the door photo).
        qc.invalidateQueries({ queryKey: jobActionsKey(bookingId) }),
      ]),
  });

  async function add(stage: Exclude<PhotoStage, "COMPLETION">) {
    const photo = await pickPhoto({ title: `Add ${PHOTO_STAGE_LABEL[stage].toLowerCase()} photo` });
    if (photo) upload.mutate({ stage, photo });
  }

  const groups = photosByStage(evidence.data);
  const total = groups.reduce((n, g) => n + g.photos.length, 0) + staged.length;
  const firstOpen = openStages[0] ?? null;
  const failedUpload = upload.isError ? upload.variables : undefined;

  return (
    <Collapsible
      title="Photos"
      icon={Camera}
      summary={evidence.isLoading ? null : total === 0 ? (proof.required ? "Photos are required for this job" : "No photos yet") : `${total} ${total === 1 ? "photo" : "photos"}`}
      summaryTone={proof.required && !proof.ready ? "warning" : undefined}
      defaultOpen={defaultOpen}
      testID="job-photos"
    >
      {proof.required ? <Banner tone={proof.ready ? "info" : "warning"} message={proof.ask} testID="job-proof-required" /> : null}

      {failedUpload ? (
        <Banner
          tone="danger"
          testID="job-photo-error"
          title="Photo not added"
          message={failureSentence(upload.error, "The photo could not be uploaded.")}
          action={<Button label="Try again" variant="secondary" onPress={() => upload.mutate(failedUpload)} loading={upload.isPending} testID="job-photo-retry" />}
        />
      ) : null}

      {evidence.isLoading ? (
        <PanelLoading label="Loading photos" lines={2} />
      ) : evidence.isError && !evidence.data ? (
        <PanelError error={evidence.error} onRetry={() => void evidence.refetch()} retrying={evidence.isFetching} testID="job-photos-load-error" />
      ) : (
        groups.map((group) => {
          const open = openStages.includes(group.stage);
          const isCompletion = group.stage === "COMPLETION";
          const addId = group.stage === firstOpen ? "job-photo-add" : `job-photo-add-${group.stage.toLowerCase()}`;
          const stagedHere = isCompletion ? staged : [];
          const uploadingHere = upload.isPending && upload.variables?.stage === group.stage;
          return (
            <View key={group.stage} style={styles.group} testID={`job-photos-${group.stage.toLowerCase()}`}>
              <SubHeading>{group.label}</SubHeading>
              {group.photos.length === 0 && stagedHere.length === 0 ? <PanelEmpty>{`No ${group.label.toLowerCase()} photo yet.`}</PanelEmpty> : null}
              {group.photos.length || stagedHere.length ? (
                <View style={styles.grid}>
                  {group.photos.map((row, i) => (
                    <EvidenceThumb
                      key={row.id}
                      row={row}
                      label={`${group.label} photo ${i + 1}, ${formatDateTime(row.capturedAt)}`}
                      onOpen={(source, label) => setViewing({ source, label })}
                    />
                  ))}
                  {stagedHere.map((photo, i) => (
                    <View key={photo.pickedAtMs} style={styles.stagedTile}>
                      {photo.previewUri ? (
                        <Pressable
                          onPress={() => setViewing({ source: { uri: photo.previewUri as string }, label: `Completion photo ${i + 1}, not sent yet` })}
                          accessibilityRole="imagebutton"
                          accessibilityLabel={`Completion photo ${i + 1}, not sent yet. Opens full screen`}
                        >
                          <Image source={{ uri: photo.previewUri }} style={styles.thumb} resizeMode="cover" />
                        </Pressable>
                      ) : (
                        <View style={[styles.thumb, styles.thumbFallback]}>
                          <Camera color={color.slate} size={22} />
                        </View>
                      )}
                      <Button label="Remove" variant="quiet" onPress={() => onRemoveStaged(i)} accessibilityLabel={`Remove completion photo ${i + 1}`} testID="job-completion-photo-remove" />
                    </View>
                  ))}
                </View>
              ) : null}
              {stagedHere.length ? <T kind="small">Sent when you complete the job.</T> : null}
              {open && isCompletion ? (
                stagedHere.length < EVIDENCE_MAX_PHOTOS_PER_UPLOAD ? (
                  <Button label={stagedHere.length ? "Add another completion photo" : "Add completion photo"} icon={Camera} variant="secondary" onPress={onAddCompletionPhoto} testID={addId} />
                ) : (
                  <T kind="small">{`${EVIDENCE_MAX_PHOTOS_PER_UPLOAD} photos can be sent with the completion.`}</T>
                )
              ) : open ? (
                <Button
                  label={`Add ${group.label.toLowerCase()} photo`}
                  icon={Camera}
                  variant="secondary"
                  onPress={() => void add(group.stage as Exclude<PhotoStage, "COMPLETION">)}
                  loading={uploadingHere}
                  disabled={upload.isPending}
                  testID={addId}
                />
              ) : null}
            </View>
          );
        })
      )}

      <PhotoViewer viewing={viewing} onClose={() => setViewing(null)} />
    </Collapsible>
  );
}

/**
 * One stored photo. The media route answers only the signed-in partner, so the source carries the
 * bearer token and is rebuilt when the token is refreshed. An `Image` cannot refresh-and-retry on a
 * 401: a photo that does not load says so in words instead of leaving a blank square.
 */
function EvidenceThumb({ row, label, onOpen }: { row: JobEvidenceItem; label: string; onOpen: (source: EvidenceImageSource, label: string) => void }) {
  const token = useAuthStore((s) => s.accessToken);
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [token, row.mediaAccessUrl]);
  const source = partnerApi.evidenceImageSource(row, token);
  if (!source || failed) {
    return (
      <View style={[styles.thumb, styles.thumbFallback]} accessible accessibilityLabel={`${label}. Saved, but it could not be shown here`}>
        <ImageOff color={color.slate} size={22} />
        <T kind="caption" style={styles.center}>
          Saved, not shown
        </T>
      </View>
    );
  }
  return (
    <Pressable onPress={() => onOpen(source, label)} accessibilityRole="imagebutton" accessibilityLabel={`${label}. Opens full screen`} testID="job-photo-thumb">
      <Image source={source} onError={() => setFailed(true)} style={styles.thumb} resizeMode="cover" />
    </Pressable>
  );
}

function PhotoViewer({ viewing, onClose }: { viewing: { source: EvidenceImageSource; label: string } | null; onClose: () => void }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [viewing]);
  return (
    <Modal visible={viewing !== null} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <SafeAreaView style={styles.viewer} edges={["top", "bottom"]} testID="job-photo-viewer">
        <View style={styles.viewerHead}>
          <T kind="bodyStrong" tone="onLeaf" style={styles.flex} numberOfLines={2}>
            {viewing?.label ?? ""}
          </T>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Close photo" testID="job-photo-viewer-close" style={({ pressed }) => [styles.viewerClose, pressed ? styles.viewerClosePressed : null]}>
            <X color={color.onLeaf} size={24} />
          </Pressable>
        </View>
        {viewing && !failed ? (
          <Image source={viewing.source} onError={() => setFailed(true)} style={styles.flex} resizeMode="contain" accessibilityRole="image" accessibilityLabel={viewing.label} />
        ) : viewing ? (
          <View style={styles.viewerFailed}>
            <ImageOff color={color.onLeaf} size={28} />
            <T kind="body" tone="onLeaf" style={styles.center} accessibilityRole="alert">
              This photo could not be shown. Close it and try again.
            </T>
          </View>
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

const THUMB = 88;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  center: { textAlign: "center" },
  group: { gap: space.sm },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
  thumb: { width: THUMB, height: THUMB, borderRadius: radius.control, borderWidth: 1, borderColor: color.line, backgroundColor: color.well },
  thumbFallback: { alignItems: "center", justifyContent: "center", gap: space.xs, padding: space.xs },
  stagedTile: { width: THUMB + space.lg, alignItems: "center" },
  viewer: { flex: 1, backgroundColor: color.ink },
  viewerHead: { flexDirection: "row", alignItems: "center", gap: space.md, paddingHorizontal: space.lg, paddingVertical: space.sm },
  viewerClose: { width: touch.min, height: touch.min, borderRadius: radius.control, alignItems: "center", justifyContent: "center" },
  viewerClosePressed: { backgroundColor: color.slate },
  viewerFailed: { flex: 1, alignItems: "center", justifyContent: "center", gap: space.md, padding: space.xl },
});
