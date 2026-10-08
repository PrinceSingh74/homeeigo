import { BookOpen, Check, ExternalLink } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { OnboardingFrame, Problem } from "@/components/onboarding/OnboardingFrame";
import { Button, Card, EmptyState, KeyValue, Pill, SkeletonCard, T } from "@/components/ui";
import { registrationErrorSentence } from "@/lib/onboarding-form";
import { partnerRegistrationApi, type OnboardingTrainingPayload } from "@/services/partner-registration-api";
import { space } from "@/theme/tokens";

/**
 * Step 9: the training modules the server lists (`GET /onboarding/training`). Whether training is
 * needed, and for what, is the server's `policy` sentence and its `requiredForActivation` flag —
 * the step can be continued either way (`POST /onboarding/training/acknowledge`).
 */
export function TrainingStep({ loading, onContinue }: { loading: boolean; onContinue: () => void | Promise<void> }) {
  const [data, setData] = useState<OnboardingTrainingPayload | null>(null);
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadProblem(null);
    partnerRegistrationApi
      .getTraining()
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((e) => {
        if (!cancelled) setLoadProblem(registrationErrorSentence(e, "Training could not be loaded."));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  function complete(moduleId: string) {
    if (busyId) return;
    setBusyId(moduleId);
    setProblem(null);
    void partnerRegistrationApi
      .completeTrainingModule(moduleId)
      .then(setData)
      .catch((e) => setProblem(registrationErrorSentence(e, "That module could not be marked complete. Try again.")))
      .finally(() => setBusyId(null));
  }

  function open(url: string) {
    setProblem(null);
    void Linking.openURL(url).catch(() => setProblem("This content could not be opened on your phone."));
  }

  const modules = data?.modules ?? [];

  return (
    <OnboardingFrame
      heading="Partner training"
      lead={data?.policy ?? null}
      error={problem}
      primary={<Button testID="onboarding-continue-review" label="Continue to review" onPress={() => void onContinue()} loading={loading} />}
    >
      {loadProblem ? (
        <Problem message={loadProblem} onRetry={() => setReloadKey((k) => k + 1)} testID="onboarding-training-load-problem" />
      ) : !data ? (
        <>
          <SkeletonCard lines={2} />
          <SkeletonCard lines={3} />
        </>
      ) : (
        <>
          <Card>
            <KeyValue label="Modules complete" value={`${data.completedCount} of ${data.requiredModules}`} strong />
            <KeyValue label="Required before activation" value={data.requiredForActivation ? "Yes" : "No"} />
          </Card>
          {modules.length === 0 ? (
            <EmptyState icon={BookOpen} title="No published modules yet" message="You can continue to review." />
          ) : (
            modules.map((mod) => (
              <Card key={mod.id} style={styles.card}>
                <View style={styles.head}>
                  <T kind="bodyStrong" style={styles.title}>
                    {mod.title}
                  </T>
                  {mod.completedAt ? <Pill label="Completed" tone="success" icon={Check} /> : <Pill label="Not started" />}
                </View>
                {mod.body ? (
                  <T kind="small" numberOfLines={4}>
                    {mod.body}
                  </T>
                ) : null}
                {mod.contentUrl || !mod.completedAt ? (
                  <View style={styles.actions}>
                    {mod.contentUrl ? (
                      <Button label="Open content" accessibilityLabel={`Open content: ${mod.title}`} variant="secondary" icon={ExternalLink} onPress={() => open(mod.contentUrl!)} style={styles.half} />
                    ) : null}
                    {!mod.completedAt ? (
                      <Button
                        label="Mark complete"
                        accessibilityLabel={`Mark complete: ${mod.title}`}
                        variant="secondary"
                        onPress={() => complete(mod.id)}
                        loading={busyId === mod.id}
                        disabled={Boolean(busyId) && busyId !== mod.id}
                        style={styles.half}
                      />
                    ) : null}
                  </View>
                ) : null}
              </Card>
            ))
          )}
        </>
      )}
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.md },
  head: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between", gap: space.sm },
  title: { flex: 1 },
  actions: { flexDirection: "row", gap: space.sm },
  half: { flex: 1 },
});
