import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Animated, Easing, Pressable, StyleSheet, View } from "react-native";
import { BackgroundLocationNotice } from "@/components/BackgroundLocationNotice";
import { Chips } from "@/components/account/controls";
import { ErrorState } from "@/components/account/states";
import { Banner, Button, Card, Pill, Skeleton, T } from "@/components/ui";
import { useAuthed, useOperationsQuery } from "@/hooks/account/queries";
import { partnerPresenceHealthCopy, usePartnerPresenceHealth } from "@/hooks/use-partner-presence-heartbeat";
import { actionForRefusal, dispatchReasons, type ReasonAction } from "@/lib/dispatch-reasons";
import { errorCode, errorSentence, isOfflineError } from "@/lib/error-sentence";
import { partnerApi } from "@/services/partner-api";
import { color, radius, space, touch } from "@/theme/tokens";

const PAUSE_REASONS = [
  { id: "break", label: "Break", accessibilityLabel: "Pause · break" },
  { id: "personal", label: "Personal", accessibilityLabel: "Pause · personal" },
  { id: "travel", label: "Travel", accessibilityLabel: "Pause · travel" },
  { id: "other", label: "Other", accessibilityLabel: "Pause · other" },
] as const;

type PauseReason = (typeof PAUSE_REASONS)[number]["id"];

const TRACK_HEIGHT = 64;
const KNOB = 52;

function FixAction({ action }: { action: ReasonAction | null }) {
  if (!action) return null;
  return <Button label={action.label} variant="secondary" onPress={() => router.push(action.href as never)} />;
}

/**
 * The partner's online / offline switch — the home screen's signature control.
 *
 * It shows the SERVER's state (`GET /me/operations`: `uiOnline`, paused, restricted), never a local
 * guess: the switch moves only after the server has answered. A refusal to go online is shown in
 * the server's sentence with the way to fix it; while online, the reasons the dispatcher would not
 * offer a job right now (`GET /me/dispatch-eligibility`) are listed underneath.
 */
export function OnlineSwitch({ showPause = false }: { showPause?: boolean }) {
  const qc = useQueryClient();
  const authed = useAuthed();
  const presence = usePartnerPresenceHealth();
  const operations = useOperationsQuery();
  const ops = operations.data;

  const online = Boolean(ops?.uiOnline) && !ops?.isPaused && !ops?.isSuspended;
  const paused = Boolean(ops?.isPaused);
  const restricted = Boolean(ops?.isSuspended);

  const eligibility = useQuery({
    queryKey: ["partner", "dispatch-eligibility"],
    queryFn: () => partnerApi.dispatchEligibility(),
    enabled: authed && Boolean(ops),
    staleTime: 15_000,
    refetchInterval: online ? 30_000 : false,
    refetchIntervalInBackground: false,
  });

  /** The server's own words after the last action ("You are online"), or its refusal. */
  const [said, setSaid] = useState<string | null>(null);
  const settle = () => {
    void qc.invalidateQueries({ queryKey: ["partner", "operations"] });
    void qc.invalidateQueries({ queryKey: ["partner", "provider"] });
    void qc.invalidateQueries({ queryKey: ["partner", "dashboard"] });
    void qc.invalidateQueries({ queryKey: ["partner", "dispatch-eligibility"] });
  };
  const recheck = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => void (recheck.current && clearTimeout(recheck.current)), []);

  /**
   * One refusal banner serves all three actions, so starting one clears what the other two last
   * said: a refusal to go online must not sit under a pause that has just succeeded.
   */
  const fresh = useRef<{ toggle: () => void; pause: () => void; resume: () => void } | null>(null);
  const begin = (action: "toggle" | "pause" | "resume") => {
    setSaid(null);
    for (const other of ["toggle", "pause", "resume"] as const) if (other !== action) fresh.current?.[other]();
  };

  const toggle = useMutation({
    mutationFn: (next: boolean) => partnerApi.setOnline(next),
    onMutate: () => begin("toggle"),
    onSuccess: (data) => {
      // The answer carries the fresh operations snapshot: show it at once, then confirm with a read.
      if (data.operations) qc.setQueryData(["partner", "operations"], data.operations);
      setSaid(data.message);
      settle();
      // Presence and location reach the dispatcher a few seconds after going online: look again then.
      if (recheck.current) clearTimeout(recheck.current);
      recheck.current = setTimeout(() => void qc.invalidateQueries({ queryKey: ["partner", "dispatch-eligibility"] }), 6_000);
    },
  });
  const pause = useMutation({
    mutationFn: (reason: PauseReason) => partnerApi.pause(reason),
    onMutate: () => begin("pause"),
    onSuccess: (data) => {
      qc.setQueryData(["partner", "operations"], data);
      settle();
    },
  });
  const resume = useMutation({
    mutationFn: () => partnerApi.resume(),
    onMutate: () => begin("resume"),
    onSuccess: (data) => {
      qc.setQueryData(["partner", "operations"], data.operations);
      setSaid(data.message);
      settle();
    },
  });
  fresh.current = { toggle: toggle.reset, pause: pause.reset, resume: resume.reset };

  const busy = toggle.isPending || pause.isPending || resume.isPending;
  const failed = toggle.error ?? pause.error ?? resume.error ?? null;

  // The knob slides when the SERVER's state changes; still for people who asked for less motion.
  const slide = useRef(new Animated.Value(online ? 1 : 0)).current;
  const [trackWidth, setTrackWidth] = useState(0);
  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      if (reduce) slide.setValue(online ? 1 : 0);
      else Animated.timing(slide, { toValue: online ? 1 : 0, duration: 220, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    });
    return () => {
      cancelled = true;
    };
  }, [online, slide]);

  if (operations.isLoading || (!ops && !operations.isError)) {
    return (
      <Card testID="online-switch-loading">
        <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading your status" style={styles.stack}>
          <Skeleton height={24} width="40%" />
          <Skeleton height={14} width="75%" />
          <Skeleton height={TRACK_HEIGHT} style={{ borderRadius: radius.pill }} />
        </View>
      </Card>
    );
  }
  if (!ops) {
    return (
      <Card testID="online-switch-error">
        <ErrorState error={operations.error} title="Your status could not be loaded" onRetry={() => void operations.refetch()} />
      </Card>
    );
  }

  const stateWord = restricted ? "Account restricted" : paused ? "Paused" : online ? "Online" : "Offline";
  const presenceLine = partnerPresenceHealthCopy({
    receiveJobs: online,
    connected: presence.connected,
    reconnecting: presence.reconnecting,
    presenceFreshness: presence.presenceFreshness,
  });
  const reasons = dispatchReasons({
    blockers: ops.readiness.blockers,
    // Eligibility is asked about only while online: offline, "not available" is the partner's own choice.
    reasons: online ? eligibility.data?.reasons : null,
    offlineByChoice: !online,
  });
  const travel = Math.max(0, trackWidth - KNOB - 12);
  const capacity = `${ops.capacity.currentJobs} of ${ops.capacity.maxConcurrentJobs} jobs`;
  const switchLabel = online ? "Go Offline" : "Go Online";

  return (
    <Card testID="online-switch">
      <View style={styles.stack}>
        <View style={styles.head}>
          <View style={styles.headText}>
            <View style={styles.stateRow}>
              <View style={[styles.dot, online ? styles.dotOn : paused ? styles.dotPaused : restricted ? styles.dotRestricted : null]} />
              <T kind="title" accessibilityRole="header" testID="online-state">
                {stateWord}
              </T>
            </View>
            <T kind="small" tone="slate">
              {restricted
                ? (ops.suspendedMessage ?? "Your account cannot be offered jobs right now.")
                : paused
                  ? "New offers are paused. Jobs you have accepted continue."
                  : online
                    ? // Never "you can be offered jobs" while the dispatcher has a reason not to, or has not answered yet.
                      (said ?? (reasons.length > 0 || !eligibility.data ? "You are online." : "You can be offered new jobs."))
                    : (said ?? "You are not being offered new jobs.")}
            </T>
          </View>
          {online ? <Pill label={capacity} tone={ops.capacity.capacityFull ? "warning" : "leaf"} testID="online-capacity" /> : null}
        </View>

        {restricted ? (
          <FixAction action={actionForRefusal("ACCOUNT_RESTRICTED")} />
        ) : paused ? (
          <Button label="Resume" onPress={() => resume.mutate()} loading={resume.isPending} disabled={busy} testID="online-resume" />
        ) : (
          <Pressable
            testID="online-toggle"
            onPress={() => toggle.mutate(!online)}
            disabled={busy}
            onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
            accessibilityRole="switch"
            accessibilityLabel={switchLabel}
            accessibilityHint={online ? "Stops new job offers. Jobs you have accepted continue." : "Lets nearby jobs be offered to you."}
            accessibilityState={{ checked: online, busy, disabled: busy }}
            style={({ pressed }) => [styles.track, online ? styles.trackOn : styles.trackOff, pressed ? styles.trackPressed : null]}
          >
            <T kind="heading" tone={online ? "onLeaf" : "ink"} style={[styles.trackLabel, online ? styles.trackLabelOn : styles.trackLabelOff]}>
              {switchLabel}
            </T>
            <Animated.View style={[styles.knob, { transform: [{ translateX: slide.interpolate({ inputRange: [0, 1], outputRange: [0, travel] }) }] }]}>
              {toggle.isPending ? <ActivityIndicator color={color.leaf} /> : <View style={[styles.knobMark, online ? styles.knobMarkOn : null]} />}
            </Animated.View>
          </Pressable>
        )}

        {failed ? (
          <Banner
            testID="online-refusal"
            tone={isOfflineError(failed) ? "warning" : "danger"}
            title={isOfflineError(failed) ? undefined : toggle.error ? (online ? "You are still online" : "You are still offline") : undefined}
            message={errorSentence(failed)}
            action={<FixAction action={actionForRefusal(errorCode(failed))} />}
          />
        ) : null}

        {reasons.length > 0 && !restricted ? (
          <View style={styles.reasons} testID="online-reasons">
            {online ? (
              <T kind="smallStrong" tone="slate">
                Why you may not be offered a job right now
              </T>
            ) : null}
            {reasons.map((r) => (
              <Banner key={r.code} testID={`online-reason-${r.code}`} tone="warning" message={r.message} action={<FixAction action={r.action} />} />
            ))}
          </View>
        ) : null}

        {presenceLine && presenceLine.tone === "warn" ? (
          <Banner tone="warning" message={presenceLine.text} testID="online-presence" />
        ) : presenceLine && reasons.length === 0 ? (
          <T kind="small" tone="success" testID="online-presence">
            {presenceLine.text}
          </T>
        ) : null}

        {online ? <BackgroundLocationNotice /> : null}

        {showPause && online ? (
          <View style={styles.pause}>
            <T kind="smallStrong" tone="slate">
              Pause new offers
            </T>
            <T kind="small">Choose why. Jobs you have accepted continue; resume when you are ready.</T>
            <Chips label="Pause new offers" options={PAUSE_REASONS} value={[]} onToggle={(id) => pause.mutate(id)} disabled={busy} testID="pause-reason" />
          </View>
        ) : null}
        {paused && ops.pauseReason ? (
          <T kind="small" testID="pause-reason-current">
            Reason: {ops.pauseReason}
          </T>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  head: { flexDirection: "row", alignItems: "flex-start", gap: space.md },
  headText: { flex: 1, gap: space.xs },
  stateRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  dot: { width: 12, height: 12, borderRadius: radius.pill, backgroundColor: color.mist },
  dotOn: { backgroundColor: color.success },
  dotPaused: { backgroundColor: color.marigold },
  dotRestricted: { backgroundColor: color.danger },

  track: { minHeight: Math.max(TRACK_HEIGHT, touch.min), borderRadius: radius.pill, borderWidth: 2, justifyContent: "center", padding: 4 },
  trackOn: { backgroundColor: color.leaf, borderColor: color.leaf },
  trackOff: { backgroundColor: color.well, borderColor: color.line },
  trackPressed: { opacity: 0.85 },
  trackLabel: { position: "absolute", left: 0, right: 0, textAlign: "center" },
  // The label sits on the side the knob is not.
  trackLabelOn: { paddingRight: KNOB },
  trackLabelOff: { paddingLeft: KNOB },
  knob: { width: KNOB, height: KNOB, borderRadius: radius.pill, backgroundColor: color.surface, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: color.line },
  knobMark: { width: 14, height: 14, borderRadius: radius.pill, backgroundColor: color.mist },
  knobMarkOn: { backgroundColor: color.leaf },

  reasons: { gap: space.sm },
  pause: { gap: space.sm, paddingTop: space.md, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line },
});
