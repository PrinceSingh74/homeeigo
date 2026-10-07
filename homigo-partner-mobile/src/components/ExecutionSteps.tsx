import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle } from "lucide-react-native";
import { useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { NoteField, PanelEmpty, PanelError, PanelLoading } from "@/components/job/parts";
import type { PickedEvidence } from "@/components/job/PhotoPicker";
import { Banner, Button, Pill, T } from "@/components/ui";
import { evidenceUploadId } from "@/lib/evidence-photo";
import { formatMinutes } from "@/lib/job-brief";
import { failureSentence } from "@/lib/job-screen";
import { completeBody, completePlan, stepMetaLabel, stepStateLabel, type CompletePlan } from "@/lib/step-evidence";
import { newIdempotencyKey, partnerApi } from "@/services/partner-api";
import { color, space, type Tone } from "@/theme/tokens";
import type { ExecutionStepAction, ExecutionStepView } from "@/types/partner";

/**
 * Phase 10 §8 — the job's work plan (mirror of partner web's ExecutionSteps). Server truth: buttons
 * ask, the server decides. State is a word in a pill, never colour alone.
 *
 * What a step needs to be marked done is its evidence kind (`completePlan`):
 *  - a note            → asked for in a labelled field, sent in the body;
 *  - a photo           → picked now (camera first), uploaded as job evidence, its id sent with the step;
 *  - before and after  → a before photo (START stage) and an after photo (COMPLETION stage), in turn.
 * Nothing is attached that the partner did not choose, and a photo the picker refuses (HEIC, too
 * large) is refused before any request.
 *
 * Loading, "This service has no steps" and a failed load are three different things on screen.
 */

const STATE_TONE: Record<string, Tone> = { COMPLETED: "success", IN_PROGRESS: "leaf", READY: "info", BLOCKED: "warning", FAILED: "danger", ESCALATED: "warning", SKIPPED_WITH_REASON: "neutral", PENDING: "neutral" };
const SECONDARY: Array<{ action: "SKIP" | "FAIL" | "ESCALATE"; label: string }> = [
  { action: "SKIP", label: "Skip" },
  { action: "FAIL", label: "Couldn't do it" },
  { action: "ESCALATE", label: "Escalate" },
];
const REASON_MAX = 500;
const NOTE_MAX = 1000;

type ActVars = { step: ExecutionStepView; action: Lowercase<ExecutionStepAction>; body?: Record<string, string>; plan?: CompletePlan };

class StepPhotoMissing extends Error {}

export function ExecutionSteps({
  bookingId,
  pickPhoto,
  enabled = true,
}: {
  bookingId: string;
  pickPhoto: (ask: { title: string; note?: string }) => Promise<PickedEvidence | null>;
  enabled?: boolean;
}) {
  const qc = useQueryClient();
  const [entry, setEntry] = useState<{ code: string; action: Lowercase<ExecutionStepAction> } | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const query = useQuery({ queryKey: ["partner", "execution", bookingId], queryFn: () => partnerApi.getExecution(bookingId), enabled: !!bookingId && enabled, staleTime: 10_000 });

  // What one step action has already sent, kept until that action SUCCEEDS: a retry after a failed
  // request re-uses the photos already uploaded and the same idempotency key, instead of asking for
  // new photos and adding more evidence rows under a new key.
  const sent = useRef(new Map<string, { ids: string[]; key: string }>());

  const act = useMutation({
    mutationFn: async (v: ActVars) => {
      const slot = `${v.step.code}:${v.action}`;
      const kept = sent.current.get(slot) ?? { ids: [], key: newIdempotencyKey(`step-${v.step.code}-${v.action}`) };
      sent.current.set(slot, kept);
      let body = v.body;
      if (v.plan?.photos.length) {
        const ids = kept.ids;
        for (const wanted of v.plan.photos.slice(ids.length)) {
          const title = v.plan.photos.length > 1 ? (wanted.stage === "START" ? "Add before photo" : "Add after photo") : "Add step photo";
          const photo = await pickPhoto({ title, note: `Step ${v.step.stepNumber}: ${v.step.title}` });
          if (!photo) throw new StepPhotoMissing(wanted.prompt);
          const row = await partnerApi.uploadEvidence(bookingId, {
            stage: wanted.stage,
            mediaUrl: photo.dataUrl,
            clientUploadId: evidenceUploadId(wanted.stage, photo.pickedAtMs, `step-${v.step.code}`),
          });
          ids.push(row.id);
        }
        body = { ...(v.body ?? {}), ...completeBody(v.plan, ids) };
      }
      return partnerApi.executionAction(bookingId, v.step.code, v.action, body, kept.key);
    },
    onMutate: () => setError(null),
    onSuccess: (_data, v) => {
      sent.current.delete(`${v.step.code}:${v.action}`);
      setEntry(null);
      setText("");
    },
    onError: (e, v) => setError({ code: v.step.code, message: e instanceof StepPhotoMissing ? e.message : failureSentence(e, "This step could not be updated.") }),
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["partner", "execution", bookingId] }),
        qc.invalidateQueries({ queryKey: ["partner", "job-evidence", bookingId] }),
      ]),
  });

  if (query.isLoading) return <PanelLoading label="Loading service steps" lines={4} />;
  if (query.isError && !query.data) return <PanelError error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} testID="execution-load-error" />;
  const view = query.data;
  if (!view || !view.enforced || view.steps.length === 0) return <PanelEmpty testID="execution-empty">This service has no steps.</PanelEmpty>;

  return (
    <View testID="execution-steps" style={styles.stack}>
      <Banner tone={view.gate.ok ? "success" : "info"} testID="execution-gate" message={view.gate.ok ? "All required steps are done." : "The job can be completed once every required step is done."} />
      {view.steps.map((s) => {
        const busy = act.isPending && act.variables?.step.code === s.code;
        const plan = completePlan(s.evidence);
        const open = entry?.code === s.code ? entry : null;
        const isNote = open?.action === "complete";
        const trimmed = text.trim();
        return (
          <View key={s.code} style={styles.item} testID={`step-${s.code}`}>
            <View accessible accessibilityLabel={`Step ${s.stepNumber}, ${s.title}${s.mandatory ? "" : ", optional"}: ${stepMetaLabel(s.state, s.evidence)}`} style={styles.head}>
              <T kind="bodyStrong">{`${s.stepNumber}. ${s.title}${s.mandatory ? "" : " (optional)"}`}</T>
              <Pill label={stepStateLabel(s.state)} tone={STATE_TONE[s.state] ?? "neutral"} />
              <T kind="small">
                {stepMetaLabel(s.state, s.evidence)}
                {typeof s.estimatedMinutes === "number" && s.estimatedMinutes > 0 ? ` · about ${formatMinutes(s.estimatedMinutes)}` : ""}
              </T>
            </View>
            {s.description ? <T kind="body">{s.description}</T> : null}
            {/* Absent on an older server build: none. */}
            {s.materials?.length ? <T kind="small">{`Materials: ${s.materials.join(", ")}`}</T> : null}
            {s.equipment?.length ? <T kind="small">{`Equipment: ${s.equipment.join(", ")}`}</T> : null}
            {s.ppe?.length ? <T kind="small">{`Wear: ${s.ppe.join(", ")}`}</T> : null}
            {s.blockedBy?.detail?.length ? <T kind="small" tone="warning">{`Waiting on: ${s.blockedBy.detail.join(", ")}`}</T> : null}
            {(s.warnings ?? []).map((w) => (
              <View key={w} style={styles.warning} accessible accessibilityLabel={`Warning: ${w}`}>
                <AlertTriangle color={color.marigold} size={16} />
                <T kind="small" tone="warning" style={styles.flex}>
                  {w}
                </T>
              </View>
            ))}
            {s.note ? <T kind="small">{`Your note: ${s.note}`}</T> : null}
            {s.reason ? <T kind="small">{`Reason given: ${s.reason}`}</T> : null}

            {open ? (
              <View style={styles.actions}>
                <NoteField
                  label={isNote ? "Note for this step" : "Reason"}
                  value={text}
                  onChangeText={setText}
                  maxLength={isNote ? NOTE_MAX : REASON_MAX}
                  help="At least 3 characters."
                  testID={`step-${s.code}-text`}
                />
                <Button
                  label="Confirm"
                  variant="secondary"
                  loading={busy}
                  disabled={act.isPending || trimmed.length < 3}
                  onPress={() => act.mutate({ step: s, action: open.action, body: isNote ? { note: trimmed } : { reason: trimmed } })}
                  testID={`step-${s.code}-confirm`}
                />
                <Button
                  label="Go back"
                  variant="quiet"
                  disabled={act.isPending}
                  onPress={() => {
                    setEntry(null);
                    setText("");
                  }}
                />
              </View>
            ) : (
              <View style={styles.actions}>
                {s.actions.includes("START") ? (
                  <Button label="Start step" variant="secondary" accessibilityLabel={`Start step ${s.stepNumber}`} loading={busy && act.variables?.action === "start"} disabled={act.isPending} onPress={() => act.mutate({ step: s, action: "start" })} />
                ) : null}
                {s.actions.includes("COMPLETE") ? (
                  <Button
                    label={plan.buttonLabel}
                    variant="secondary"
                    accessibilityLabel={plan.photos.length || plan.note ? `${plan.buttonLabel.replace(" · Done", "")} and mark step ${s.stepNumber} done` : `Mark step ${s.stepNumber} done`}
                    loading={busy && act.variables?.action === "complete"}
                    disabled={act.isPending}
                    onPress={() => {
                      // A note step asks for the note first; a photo step picks its photos (see the mutation).
                      if (plan.note) {
                        setEntry({ code: s.code, action: "complete" });
                        setText("");
                      } else act.mutate({ step: s, action: "complete", plan });
                    }}
                  />
                ) : null}
                {SECONDARY.filter((a) => s.actions.includes(a.action)).map((a) => (
                  <Button
                    key={a.action}
                    label={a.label}
                    variant="quiet"
                    accessibilityLabel={`${a.label}: step ${s.stepNumber}`}
                    disabled={act.isPending}
                    onPress={() => {
                      setEntry({ code: s.code, action: a.action.toLowerCase() as Lowercase<ExecutionStepAction> });
                      setText("");
                    }}
                  />
                ))}
              </View>
            )}
            {error?.code === s.code ? <Banner tone="danger" message={error.message} testID={`step-${s.code}-error`} /> : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  stack: { gap: space.md },
  item: { gap: space.sm, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
  head: { gap: space.xs },
  warning: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  actions: { gap: space.sm },
});
