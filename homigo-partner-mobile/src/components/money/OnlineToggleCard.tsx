import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { BackgroundLocationNotice } from "@/components/BackgroundLocationNotice";
import { QueryError, failureSentence } from "@/components/money/DataScreen";
import { Banner, Button, Card, KeyValue, Skeleton, T } from "@/components/ui";
import { K, useOperationsQuery, useProviderQuery, useSessionReady } from "@/hooks/money/queries";
import { partnerPresenceHealthCopy, usePartnerPresenceHealth } from "@/hooks/use-partner-presence-heartbeat";
import { dispatchReasons } from "@/lib/dispatch-reasons";
import { partnerApi } from "@/services/partner-api";
import { space } from "@/theme/tokens";

type Outcome = { tone: "success" | "danger"; text: string };

/**
 * Online / offline, from `GET /api/providers/me/operations` (the provider row is the fallback while
 * that loads). Until one of them answers the card shows loading — it never assumes "offline".
 * Every tap ends in something the partner can read: the server's own sentence ("You are online"),
 * or its refusal.
 */
export function OnlineToggleCard() {
  const qc = useQueryClient();
  const presence = usePartnerPresenceHealth();
  const provider = useProviderQuery();
  const operations = useOperationsQuery();
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const ready = useSessionReady();
  const onlineNow = Boolean(operations.data?.uiOnline) && !operations.data?.isPaused && !operations.data?.isSuspended;
  /** Would the dispatcher offer a job right now (the same read the home switch uses). Asked only while online. */
  const eligibility = useQuery({
    queryKey: ["partner", "dispatch-eligibility"],
    queryFn: () => partnerApi.dispatchEligibility(),
    enabled: ready && onlineNow,
    staleTime: 15_000,
  });

  const refreshAll = () => {
    for (const queryKey of [K.provider, K.dashboard, K.operations, ["partner", "dispatch-eligibility"]]) void qc.invalidateQueries({ queryKey });
  };

  const toggle = useMutation({
    mutationFn: (online: boolean) => partnerApi.setOnline(online),
    onMutate: () => setOutcome(null),
    onSuccess: (result) => {
      if (result.operations) qc.setQueryData(K.operations, result.operations);
      refreshAll();
      if (result.message) setOutcome({ tone: "success", text: result.message });
    },
    onError: (error) => {
      setOutcome({ tone: "danger", text: failureSentence(error) });
      refreshAll();
    },
  });

  const resume = useMutation({
    mutationFn: () => partnerApi.resume(),
    onMutate: () => setOutcome(null),
    onSuccess: (result) => {
      qc.setQueryData(K.operations, result.operations);
      refreshAll();
      // The server's sentence, or nothing: the card's state line already shows the change.
      setOutcome(result.message ? { tone: "success", text: result.message } : null);
    },
    onError: (error) => setOutcome({ tone: "danger", text: failureSentence(error) }),
  });

  const ops = operations.data;
  const online: boolean | undefined = ops?.uiOnline ?? provider.data?.isOnline;

  if (online === undefined) {
    if (operations.isError && provider.isError) {
      return (
        <QueryError
          error={operations.error}
          title="Could not load your online status"
          onRetry={() => {
            void operations.refetch();
            void provider.refetch();
          }}
          testID="online-card-error"
        />
      );
    }
    return (
      <Card testID="online-card-loading">
        <View accessible accessibilityRole="progressbar" accessibilityLabel="Loading your online status…" style={styles.stack}>
          <Skeleton height={20} width="40%" />
          <Skeleton height={14} />
          <Skeleton height={52} />
        </View>
      </Card>
    );
  }

  const paused = ops?.isPaused ?? false;
  const suspended = ops?.isSuspended ?? false;
  const busy = toggle.isPending || resume.isPending;
  const presenceLine = partnerPresenceHealthCopy({
    receiveJobs: online && !paused && !suspended,
    connected: presence.connected,
    reconnecting: presence.reconnecting,
    presenceFreshness: presence.presenceFreshness,
  });
  const blockers = ops?.readiness?.blockers ?? [];
  // Why the dispatcher would not offer a job right now. Readiness blockers are listed below already.
  const blockerCodes = new Set(blockers.map((b) => b.code));
  const reasons = onlineNow
    ? dispatchReasons({ blockers, reasons: eligibility.data?.reasons, offlineByChoice: false }).filter((r) => !blockerCodes.has(r.code))
    : [];
  // "You can be offered jobs" is said only once the dispatcher has answered and has no reason not to.
  const canBeOffered = onlineNow && Boolean(eligibility.data) && blockers.length === 0 && reasons.length === 0;

  return (
    <Card testID="online-card">
      <View style={styles.stack}>
        <T kind="heading" accessibilityRole="header" testID="online-card-state">
          {suspended ? "Account restricted" : paused ? "Paused" : online ? "Online" : "Offline"}
        </T>
        <T kind="small" tone="ink">
          {suspended
            ? (ops?.suspendedMessage ?? "Your account cannot be offered jobs right now.")
            : paused
              ? "New offers are paused. Jobs you already hold continue."
              : online
                ? canBeOffered
                  ? "You can be offered jobs."
                  : "You are online."
                : "You will not be offered new jobs while you are offline."}
        </T>

        {presenceLine ? <Banner tone={presenceLine.tone === "ok" ? "success" : "warning"} message={presenceLine.text} /> : null}
        {online && !suspended ? <BackgroundLocationNotice /> : null}

        {ops ? (
          <View>
            <KeyValue label="Jobs you hold now" value={`${ops.capacity.currentJobs} of ${ops.capacity.maxConcurrentJobs}`} />
            <KeyValue label="Slots open" value={String(ops.capacity.availableSlots)} />
          </View>
        ) : null}

        {blockers.map((b) => (
          <Banner key={b.code} tone="warning" message={b.message} />
        ))}
        {reasons.length > 0 ? (
          <View style={styles.reasons} testID="online-card-reasons">
            <T kind="smallStrong" tone="slate">
              Why you may not be offered a job right now
            </T>
            {reasons.map((r) => (
              <Banner key={r.code} tone="warning" message={r.message} />
            ))}
          </View>
        ) : null}

        {outcome ? <Banner tone={outcome.tone} message={outcome.text} testID="online-card-outcome" /> : null}

        {paused && !suspended ? (
          <Button label="Resume" onPress={() => resume.mutate()} loading={resume.isPending} disabled={busy} testID="online-card-resume" />
        ) : (
          <Button
            label={online ? "Go Offline" : "Go Online"}
            variant={online ? "secondary" : "primary"}
            onPress={() => toggle.mutate(!online)}
            loading={toggle.isPending}
            disabled={busy || suspended}
            hint={suspended ? "Not available while your account is restricted." : null}
            testID="online-card-toggle"
          />
        )}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.md },
  reasons: { gap: space.sm },
});
