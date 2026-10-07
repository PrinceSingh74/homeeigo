import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle, RotateCcw, XCircle, type LucideIcon } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { JobLocationBanner } from "@/components/job/JobStates";
import { NoteField, PanelEmpty, PanelError, PanelLoading } from "@/components/job/parts";
import { Banner, Button, T } from "@/components/ui";
import { jobActionsKey } from "@/hooks/job/use-job-lifecycle";
import { getJobCoords } from "@/lib/job-coords";
import { failureSentence, locationRefusal, type LocationRefusal } from "@/lib/job-screen";
import { newIdempotencyKey, partnerApi } from "@/services/partner-api";
import { color, space, tone, type Tone } from "@/theme/tokens";
import type { RequirementItemView } from "@/types/partner";

/**
 * Phase 10 §6 — the on-site requirement checks (mirror of partner web's RequirementChecklist).
 *
 * The server's view of the booking's own requirement state, and buttons that record what the
 * partner FOUND on site. The server decides the gate. Position is enforced like arrival (tracker
 * P0-6 / P0-6b): the check is ALWAYS sent, with `null` coordinates when the phone has no fix, and a
 * position refusal shows the server's sentence in a banner that stays, with "Turn on location" where
 * that can help. State is readable without colour: an icon plus the state in words.
 *
 * Loading, "nothing to check" and "could not load" are three different things on screen.
 */

const STATE: Record<RequirementItemView["state"], { label: string; icon: LucideIcon; tone: Tone }> = {
  UNRESOLVED: { label: "Not checked yet", icon: Circle, tone: "neutral" },
  SATISFIED: { label: "In place", icon: CheckCircle2, tone: "success" },
  FAILED: { label: "Missing", icon: XCircle, tone: "danger" },
  EXPIRED: { label: "Check again, the appointment moved", icon: RotateCcw, tone: "warning" },
};
const POINT_LABEL: Record<RequirementItemView["enforcementPoint"], string> = {
  BEFORE_BOOKING: "confirmed at booking",
  BEFORE_ARRIVAL: "before arrival",
  AT_START: "before start",
};
const NOTE_MAX = 500;

type CheckVars = { code: string; outcome: "SATISFIED" | "FAILED"; note?: string; key: string };

export function RequirementChecklist({ bookingId, active, enabled = true }: { bookingId: string; active: boolean; enabled?: boolean }) {
  const qc = useQueryClient();
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [locationIssue, setLocationIssue] = useState<LocationRefusal | null>(null);
  const query = useQuery({
    queryKey: ["partner", "requirements", bookingId],
    queryFn: () => partnerApi.getRequirements(bookingId),
    enabled: !!bookingId && enabled,
    staleTime: 10_000,
  });
  const check = useMutation({
    mutationFn: async (vars: CheckVars) => {
      const c = await getJobCoords("strict");
      try {
        // Always sent: no fix → null coordinates, and the server decides.
        return await partnerApi.checkRequirement(bookingId, vars.code, vars.outcome, c?.latitude ?? null, c?.longitude ?? null, vars.note, vars.key);
      } catch (err) {
        const position = locationRefusal(err, !c);
        if (position) setLocationIssue(position);
        else setError(failureSentence(err, "This check could not be recorded."));
        throw err;
      }
    },
    onMutate: () => {
      setError(null);
      setLocationIssue(null);
    },
    onSuccess: () => {
      setNoteFor(null);
      setNote("");
    },
    onSettled: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["partner", "requirements", bookingId] }),
        // The START gate on the footer button is the same server state.
        qc.invalidateQueries({ queryKey: jobActionsKey(bookingId) }),
      ]),
  });

  if (query.isLoading) return <PanelLoading label="Loading requirement checks" />;
  if (query.isError && !query.data) return <PanelError error={query.error} onRetry={() => void query.refetch()} retrying={query.isFetching} testID="requirement-load-error" />;
  const view = query.data;
  if (!view || !view.enforced || view.items.length === 0) return <PanelEmpty testID="requirement-empty">This job has no on-site checks.</PanelEmpty>;
  const gate = view.gate.start;

  return (
    <View testID="requirement-checklist" style={styles.stack}>
      {active ? (
        <Banner
          tone={gate.ok ? "success" : "warning"}
          testID={gate.ok ? "requirement-gate-ok" : "requirement-gate-blocked"}
          message={gate.ok ? "All requirements are in place." : `Start is blocked. ${gate.blocking.length} ${gate.blocking.length === 1 ? "item" : "items"} to resolve on site.`}
        />
      ) : null}
      {locationIssue ? <JobLocationBanner issue={locationIssue} testID="requirement-location-banner" /> : null}
      {error ? <Banner tone="danger" message={error} testID="requirement-error" /> : null}
      {view.items.map((item) => {
        const canCheck = active && item.actions.includes("CHECK");
        const busy = check.isPending && check.variables?.code === item.code;
        const state = STATE[item.state] ?? STATE.UNRESOLVED;
        const Icon = state.icon;
        const who = item.responsibility === "CUSTOMER" ? "customer provides" : item.responsibility === "PROFESSIONAL" ? "you provide" : "shared";
        return (
          <View key={item.code} style={styles.item} testID={`requirement-${item.code}`}>
            <View style={styles.head} accessible accessibilityLabel={`${item.label}${item.optional ? ", optional" : ""}: ${state.label}`}>
              <Icon color={tone[state.tone].fg} size={20} />
              <View style={styles.flex}>
                <T kind="bodyStrong">{item.optional ? `${item.label} (optional)` : item.label}</T>
                <T kind="small">{`${state.label} · ${POINT_LABEL[item.enforcementPoint] ?? item.enforcementPoint} · ${who}`}</T>
              </View>
            </View>
            {item.blocking ? (
              <T kind="small" tone="warning">
                {item.blocking.remediation.text}
              </T>
            ) : null}
            {item.note ? <T kind="small">{`Your note: ${item.note}`}</T> : null}
            {canCheck ? (
              noteFor === item.code ? (
                <View style={styles.actions}>
                  <NoteField label="What is missing? (optional)" value={note} onChangeText={setNote} maxLength={NOTE_MAX} />
                  <Button
                    label="Confirm missing"
                    variant="danger"
                    accessibilityLabel={`Record ${item.label} as missing`}
                    loading={busy}
                    disabled={check.isPending}
                    onPress={() => check.mutate({ code: item.code, outcome: "FAILED", note: note.trim() || undefined, key: newIdempotencyKey(`req-${item.code}`) })}
                  />
                  <Button
                    label="Go back"
                    variant="quiet"
                    disabled={check.isPending}
                    onPress={() => {
                      setNoteFor(null);
                      setNote("");
                    }}
                  />
                </View>
              ) : (
                <View style={styles.actions}>
                  <Button
                    label={item.state === "SATISFIED" ? "Check again: in place" : "In place"}
                    variant="secondary"
                    accessibilityLabel={`Record ${item.label} as in place`}
                    loading={busy}
                    disabled={check.isPending}
                    onPress={() => check.mutate({ code: item.code, outcome: "SATISFIED", key: newIdempotencyKey(`req-${item.code}`) })}
                  />
                  <Button label="Not in place" variant="quiet" accessibilityLabel={`Report ${item.label} as missing`} disabled={check.isPending} onPress={() => setNoteFor(item.code)} />
                </View>
              )
            ) : null}
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
  head: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  actions: { gap: space.sm },
});
