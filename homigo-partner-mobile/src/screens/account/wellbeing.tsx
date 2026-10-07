import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { HeartPulse, MessageSquare, Phone, ShieldAlert, Siren } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Linking, Pressable, StyleSheet, View } from "react-native";
import { Chips } from "@/components/account/controls";
import { AccountScreen, ErrorState, ResultBanner, RowsSkeleton, failure, type ActionResult } from "@/components/account/states";
import { openJob } from "@/components/home/JobCard";
import { Banner, Button, Card, EmptyState, Field, ListRow, Sheet, T } from "@/components/ui";
import { useAuthed, usePullRefresh, useWellbeingQuery } from "@/hooks/account/queries";
import { SAFETY_REPORT_TYPES, dialable, safetyTypeLabel } from "@/lib/account-rules";
import { formatDateTime } from "@/lib/format";
import { getJobCoords } from "@/lib/job-coords";
import { partnerApi } from "@/services/partner-api";
import { color, radius, space, touch } from "@/theme/tokens";
import type { SafetyReportType } from "@/types/partner";

export function WellbeingInsuranceScreen() {
  const wellbeing = useWellbeingQuery();
  const { refreshing, onRefresh } = usePullRefresh(wellbeing);
  const url = wellbeing.data?.insuranceUrl;
  return (
    <AccountScreen title="Insurance" refreshing={refreshing} onRefresh={onRefresh}>
      {wellbeing.isLoading ? (
        <RowsSkeleton rows={2} label="Loading insurance" />
      ) : !wellbeing.data ? (
        <ErrorState error={wellbeing.error} title="Insurance could not be loaded" onRetry={() => void wellbeing.refetch()} />
      ) : url ? (
        <Card>
          <View style={styles.stack}>
            <T kind="body">Partner insurance is managed on a separate website. It opens in your browser.</T>
            <Button label="Open insurance portal" variant="secondary" onPress={() => void Linking.openURL(url)} testID="insurance-open" />
          </View>
        </Card>
      ) : (
        <EmptyState icon={HeartPulse} title="No insurance portal yet" message="HOMEEIGO has not set up a partner insurance portal. When it does, the link appears here." />
      )}
    </AccountScreen>
  );
}

/** SOS is two deliberate steps: hold to arm, then confirm. The server records one incident per partner and job. */
function SosCard() {
  const qc = useQueryClient();
  const [armed, setArmed] = useState(false);
  const [result, setResult] = useState<ActionResult>(null);
  const sos = useMutation({
    mutationFn: async () => {
      // SOS never waits on GPS: without a fix the server still alerts operations (hasLocation: false).
      const coords = await getJobCoords("strict").catch(() => null);
      return partnerApi.safety.triggerSos(coords ? { latitude: coords.latitude, longitude: coords.longitude } : {});
    },
    onMutate: () => setResult(null),
    onSuccess: (data) => {
      setArmed(false);
      void qc.invalidateQueries({ queryKey: ["partner", "safety-incidents"] });
      setResult({
        tone: "success",
        message: `${data.created ? "SOS sent to operations." : "SOS already active."} ${data.hasLocation ? "Your location was sent with it." : "It was sent without your location."}`,
      });
    },
    onError: (e) => setResult(failure(e, "The SOS could not be sent. Call your local emergency number.")),
  });
  return (
    <Card testID="sos-card">
      <View style={styles.stack}>
        <T kind="heading" accessibilityRole="header">
          Send an SOS
        </T>
        <T kind="body">An SOS alerts the HOMEEIGO operations team and sends your location if your phone has one. Use it when you are in danger.</T>
        {!armed ? (
          <Pressable
            testID="sos-arm"
            onLongPress={() => setArmed(true)}
            delayLongPress={600}
            accessibilityRole="button"
            accessibilityLabel="Hold to activate SOS"
            accessibilityHint="Press and hold, then confirm on the next step."
            accessibilityActions={[{ name: "activate", label: "Activate SOS" }]}
            onAccessibilityAction={(e) => {
              if (e.nativeEvent.actionName === "activate") setArmed(true);
            }}
            style={({ pressed }) => [styles.sosButton, pressed ? styles.sosPressed : null]}
          >
            <Siren color={color.danger} size={22} />
            <T kind="heading" tone="danger">
              Hold to activate SOS
            </T>
          </Pressable>
        ) : (
          <View style={styles.stack}>
            <Banner tone="danger" title="Confirm emergency?" message="Operations is alerted as soon as you confirm." />
            <Button label="Confirm emergency" variant="danger" icon={Siren} onPress={() => sos.mutate()} loading={sos.isPending} testID="sos-confirm" />
            <Button label="Cancel" variant="quiet" onPress={() => setArmed(false)} disabled={sos.isPending} testID="sos-cancel" />
          </View>
        )}
        <ResultBanner result={result} testID="sos-result" />
      </View>
    </Card>
  );
}

function EmergencyContactCard({ name, phone }: { name: string | null; phone: string | null }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [nameDraft, setNameDraft] = useState(name ?? "");
  const [phoneDraft, setPhoneDraft] = useState(phone ?? "");
  const [result, setResult] = useState<ActionResult>(null);
  useEffect(() => {
    if (!editing) {
      setNameDraft(name ?? "");
      setPhoneDraft(phone ?? "");
    }
  }, [name, phone, editing]);
  const save = useMutation({
    mutationFn: () => partnerApi.safety.updateEmergencyContact({ emergencyContactName: nameDraft.trim(), emergencyContactPhone: phoneDraft.trim() }),
    onMutate: () => setResult(null),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["partner", "wellbeing"] });
      setEditing(false);
      setResult({ tone: "success", message: "Emergency contact saved." });
    },
    onError: (e) => setResult(failure(e, "The emergency contact could not be saved.")),
  });
  const call = dialable(phone);
  const phoneOk = dialable(phoneDraft) != null;
  const valid = nameDraft.trim().length > 0 && phoneOk;
  return (
    <Card testID="emergency-contact">
      <View style={styles.stack}>
        <T kind="heading" accessibilityRole="header">
          Emergency contact
        </T>
        {editing ? (
          <>
            <Field label="Contact's name" value={nameDraft} onChangeText={setNameDraft} maxLength={100} autoComplete="name" testID="emergency-name" />
            <Field label="Contact's phone number" value={phoneDraft} onChangeText={setPhoneDraft} maxLength={20} keyboardType="phone-pad" error={phoneDraft.trim() && !phoneOk ? "Enter a phone number using digits only." : null} testID="emergency-phone" />
            <Button label="Save emergency contact" variant="secondary" onPress={() => save.mutate()} loading={save.isPending} disabled={!valid} testID="emergency-save" />
            <Button label="Cancel" variant="quiet" onPress={() => setEditing(false)} disabled={save.isPending} />
          </>
        ) : (
          <>
            <T kind="body">{name ? `${name}${phone ? ` · ${phone}` : ""}` : "No emergency contact saved. Add someone we can name to operations if you send an SOS."}</T>
            {call ? <Button label="Call emergency contact" variant="secondary" icon={Phone} onPress={() => void Linking.openURL(`tel:${call}`)} testID="emergency-call" /> : null}
            <Button label={name ? "Change emergency contact" : "Add emergency contact"} variant="secondary" onPress={() => setEditing(true)} testID="emergency-edit" />
          </>
        )}
        <ResultBanner result={result} testID="emergency-result" />
      </View>
    </Card>
  );
}

function ReportSheet({ visible, onClose, onReported }: { visible: boolean; onClose: () => void; onReported: (message: string) => void }) {
  const qc = useQueryClient();
  const [type, setType] = useState<SafetyReportType | null>(null);
  const [notes, setNotes] = useState("");
  const [problem, setProblem] = useState<ActionResult>(null);
  const report = useMutation({
    mutationFn: () => partnerApi.safety.report({ type: type!, ...(notes.trim() ? { notes: notes.trim() } : {}) }),
    onMutate: () => setProblem(null),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["partner", "safety-incidents"] });
      setType(null);
      setNotes("");
      onReported("Your report was sent to the safety team. It is listed under past incidents.");
      onClose();
    },
    onError: (e) => setProblem(failure(e, "The report could not be sent.")),
  });
  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Report a safety concern"
      dismissable={!report.isPending}
      testID="safety-report-sheet"
      footer={<Button label="Send report" onPress={() => report.mutate()} loading={report.isPending} disabled={!type} hint={!type ? "Choose what happened first." : null} testID="safety-report-send" />}
    >
      <T kind="smallStrong" tone="slate">
        What happened?
      </T>
      <Chips label="What happened" options={SAFETY_REPORT_TYPES.map((t) => ({ id: t.value, label: t.label }))} value={type ? [type] : []} onToggle={setType} disabled={report.isPending} testID="safety-report-type" />
      <Field label="Details (optional)" value={notes} onChangeText={setNotes} multiline maxLength={500} help="Up to 500 characters." testID="safety-report-notes" />
      <T kind="small">This is not an SOS. If you are in danger now, close this and send an SOS.</T>
      <ResultBanner result={problem} testID="safety-report-error" />
    </Sheet>
  );
}

export function WellbeingSosScreen() {
  const enabled = useAuthed();
  const wellbeing = useWellbeingQuery();
  const incidents = useQuery({ queryKey: ["partner", "safety-incidents"], queryFn: () => partnerApi.safety.incidents(), enabled });
  const { refreshing, onRefresh } = usePullRefresh(wellbeing, incidents);
  const [reporting, setReporting] = useState(false);
  const [result, setResult] = useState<ActionResult>(null);
  // A number is offered only when the server sent one: the app has no number of its own.
  const hotline = dialable(wellbeing.data?.sosPhone);
  return (
    <AccountScreen title="SOS" subtitle="Hold to arm, then confirm. Operations is notified once." refreshing={refreshing} onRefresh={onRefresh}>
      <SosCard />
      <Card>
        <View style={styles.stack}>
          <T kind="heading" accessibilityRole="header">
            Call for help
          </T>
          {wellbeing.isLoading ? (
            <T kind="small">Loading the emergency number…</T>
          ) : hotline ? (
            <Button label={`Call ${hotline}`} variant="secondary" icon={Phone} onPress={() => void Linking.openURL(`tel:${hotline}`)} testID="sos-call-hotline" />
          ) : (
            <T kind="body" testID="sos-no-hotline">
              Call your local emergency number.
            </T>
          )}
        </View>
      </Card>

      {wellbeing.isLoading ? (
        <RowsSkeleton rows={2} label="Loading your emergency contact" />
      ) : wellbeing.data ? (
        <EmergencyContactCard name={wellbeing.data.emergencyContactName} phone={wellbeing.data.emergencyContactPhone} />
      ) : (
        <Card>
          <ErrorState error={wellbeing.error} title="Your emergency contact could not be loaded" onRetry={() => void wellbeing.refetch()} />
        </Card>
      )}

      <Card>
        <View style={styles.stack}>
          <T kind="heading" accessibilityRole="header">
            Report a safety concern
          </T>
          <T kind="small">Tell the safety team about a threat, an accident or an unsafe place. For danger right now, send an SOS instead.</T>
          <Button label="Report a safety concern" variant="secondary" icon={ShieldAlert} onPress={() => setReporting(true)} testID="safety-report-open" />
          <ResultBanner result={result} testID="safety-report-result" />
        </View>
      </Card>

      <Card>
        <View style={styles.stack}>
          <T kind="heading" accessibilityRole="header">
            Past incidents
          </T>
          {incidents.isLoading ? (
            <T kind="small">Loading past incidents…</T>
          ) : !incidents.data ? (
            <ErrorState error={incidents.error} title="Past incidents could not be loaded" onRetry={() => void incidents.refetch()} />
          ) : incidents.data.length === 0 ? (
            <T kind="small">You have not sent an SOS or a safety report. Anything you send is listed here with its status.</T>
          ) : (
            incidents.data.map((i, n) => (
              <ListRow
                key={i.id}
                testID={`safety-incident-${i.id}`}
                title={safetyTypeLabel(i.type)}
                subtitle={`${formatDateTime(i.createdAt)} · ${i.status.replace(/_/g, " ").toLowerCase()}${i.resolvedAt ? ` · resolved ${formatDateTime(i.resolvedAt)}` : ""}${i.bookingId ? " · opens the job" : ""}`}
                tone={i.resolvedAt ? "neutral" : "warning"}
                icon={ShieldAlert}
                onPress={i.bookingId ? () => openJob(i.bookingId!) : undefined}
                last={n === incidents.data.length - 1}
              />
            ))
          )}
        </View>
      </Card>
      <ReportSheet visible={reporting} onClose={() => setReporting(false)} onReported={(message) => setResult({ tone: "success", message })} />
    </AccountScreen>
  );
}

export function WellbeingCommunityScreen() {
  const enabled = useAuthed();
  const wellbeing = useWellbeingQuery();
  const recent = useQuery({ queryKey: ["partner", "notifications", "community"], queryFn: () => partnerApi.notifications.list({ limit: 10 }), enabled });
  const { refreshing, onRefresh } = usePullRefresh(wellbeing, recent);
  const url = wellbeing.data?.communityUrl;
  const rows = recent.data?.notifications;
  return (
    <AccountScreen title="Community" refreshing={refreshing} onRefresh={onRefresh}>
      {wellbeing.isLoading ? (
        <RowsSkeleton rows={1} label="Loading community" />
      ) : wellbeing.data && url ? (
        <Button label="Open the partner community" variant="secondary" onPress={() => void Linking.openURL(url)} testID="community-open" />
      ) : wellbeing.data ? (
        <EmptyState icon={MessageSquare} title="No community link yet" message="HOMEEIGO has not set up a partner community. When it does, the link appears here." />
      ) : (
        <ErrorState error={wellbeing.error} title="Community could not be loaded" onRetry={() => void wellbeing.refetch()} />
      )}
      <Card>
        <View style={styles.stack}>
          <T kind="heading" accessibilityRole="header">
            Your latest notifications
          </T>
          {recent.isLoading ? (
            <T kind="small">Loading…</T>
          ) : !rows ? (
            <ErrorState error={recent.error} onRetry={() => void recent.refetch()} />
          ) : rows.length === 0 ? (
            <T kind="small">Messages HOMEEIGO sends you appear here.</T>
          ) : (
            rows.map((n, i) => <ListRow key={n.id} title={n.title} subtitle={`${n.message} · ${formatDateTime(n.createdAt)}`} last={i === rows.length - 1} />)
          )}
          <Button label="Open notifications" variant="quiet" onPress={() => router.push("/hq/account-notifications")} />
        </View>
      </Card>
    </AccountScreen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  sosButton: { minHeight: touch.min + 16, borderRadius: radius.control, borderWidth: 2, borderColor: color.danger, backgroundColor: color.dangerWash, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: space.sm, paddingHorizontal: space.lg },
  sosPressed: { opacity: 0.8 },
});
