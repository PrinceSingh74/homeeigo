import { router } from "expo-router";
import { CloudOff, MapPinOff, UserX } from "lucide-react-native";
import { useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { Banner, Button, Card, EmptyState, Skeleton, SkeletonCard } from "@/components/ui";
import { requestJobLocationAccess } from "@/lib/job-coords";
import { failureSentence, isOfflineError, OFFLINE_SENTENCE, type LocationRefusal } from "@/lib/job-screen";
import { space } from "@/theme/tokens";

const JOBS_LIST = "/(tabs)/requests";

/** Loading with the shape of the job screen: the rail, then the brief. */
export function JobLoading() {
  return (
    <View style={styles.stack} accessible accessibilityRole="progressbar" accessibilityLabel="Loading job" testID="job-loading">
      <Card>
        <Skeleton height={18} width="40%" />
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} height={22} width={i % 2 ? "45%" : "60%"} style={{ marginTop: space.lg }} />
        ))}
      </Card>
      <SkeletonCard lines={4} />
      <SkeletonCard lines={2} />
    </View>
  );
}

/**
 * The server answered 404: this job is not the partner's (any more) — it was reassigned, or it was
 * an offer that ended. Nothing about the job is shown and there is no live button, only the way
 * back to the jobs list.
 */
export function JobGone() {
  return (
    <EmptyState
      testID="job-gone"
      icon={UserX}
      title="This job is no longer yours"
      message="It was given to another partner, or the offer ended. There is nothing more for you to do on it."
      action={<Button label="Back to jobs" onPress={() => router.replace(JOBS_LIST)} testID="job-gone-back" />}
    />
  );
}

/** The job could not be read and nothing is cached: offline is told apart from a refusal, with a retry. */
export function JobLoadError({ error, onRetry, retrying }: { error: unknown; onRetry: () => void; retrying: boolean }) {
  const offline = isOfflineError(error);
  return (
    <EmptyState
      testID="job-load-error"
      icon={CloudOff}
      title={offline ? "You're offline" : "This job could not be loaded"}
      message={offline ? OFFLINE_SENTENCE : failureSentence(error)}
      action={
        <View style={styles.actions}>
          <Button label="Try again" onPress={onRetry} loading={retrying} testID="job-load-retry" />
          <Button label="Back to jobs" variant="quiet" onPress={() => router.replace(JOBS_LIST)} />
        </View>
      }
    />
  );
}

/**
 * The server refused an arrival, a start or an on-site check because of position
 * (LOCATION_REQUIRED, OUTSIDE_SERVICE_AREA, LOCATION_UNCONFIRMED, LOCATION_MISMATCH). Its sentence
 * stays on screen until the partner acts — it is not a toast. "Turn on location" is offered only
 * where it can help (`offerLocationSettings`): it asks for the permission again, asks Android to
 * switch location on, or opens the app's settings.
 */
export function JobLocationBanner({ issue, testID = "job-location-banner" }: { issue: LocationRefusal; testID?: string }) {
  const [working, setWorking] = useState(false);
  const [outcome, setOutcome] = useState<string | null>(null);

  async function turnOn() {
    setWorking(true);
    setOutcome(null);
    const result = await requestJobLocationAccess(() => Linking.openSettings());
    setWorking(false);
    setOutcome(
      result === "ready"
        ? "Location is on. Try the step again."
        : result === "opened_settings"
          ? "Turn location on for this app in Settings, then come back and try again."
          : "Settings could not be opened. Turn location on for this app in your phone's settings.",
    );
  }

  return (
    <View style={styles.banner}>
      <Banner
        tone="warning"
        testID={testID}
        title="Location problem"
        message={issue.message || "Your location could not be confirmed."}
        action={issue.offerLocationSettings ? <Button label="Turn on location" icon={MapPinOff} variant="secondary" onPress={() => void turnOn()} loading={working} testID="job-location-turn-on" /> : undefined}
      />
      {outcome ? <Banner tone="info" message={outcome} testID="job-location-outcome" /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  actions: { gap: space.sm },
  banner: { gap: space.sm },
});
