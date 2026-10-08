import { useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Choice, OnboardingFrame, Problem } from "@/components/onboarding/OnboardingFrame";
import { Banner, Button, Card, Pill, SkeletonCard, T } from "@/components/ui";
import { registrationErrorSentence } from "@/lib/onboarding-form";
import { partnerRegistrationApi } from "@/services/partner-registration-api";
import { color, radius, space } from "@/theme/tokens";

type Question = { id: string; prompt: string; options: Array<{ id: string; label: string }> };
type Pack = { questions: Question[]; skillSlug: string; passScore: number };
type Scored = { passed: boolean; score: number; maxScore: number; correctCount: number; total: number };

/**
 * Step 8: the server's questions for the applicant's skill (`GET /onboarding/assessment`), scored
 * by the server (`POST`, every question answered). The pass mark and the score are the server's.
 */
export function AssessmentStep({ loading, onPassed }: { loading: boolean; onPassed: () => void | Promise<void> }) {
  const [pack, setPack] = useState<Pack | null>(null);
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<Scored | null>(null);
  const submitLock = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoadProblem(null);
    partnerRegistrationApi
      .getAssessment()
      .then((data) => {
        if (!cancelled) setPack({ questions: data.questions ?? [], skillSlug: data.skillSlug, passScore: data.passScore });
      })
      .catch((e) => {
        if (!cancelled) setLoadProblem(registrationErrorSentence(e, "The assessment could not be loaded."));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const questions = pack?.questions ?? [];
  const answered = questions.filter((q) => answers[q.id]).length;

  async function submit() {
    if (!pack || busy) return;
    if (questions.some((q) => !answers[q.id])) {
      setError("Answer every question before submitting.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      setResult(await partnerRegistrationApi.runAssessment({ skillSlug: pack.skillSlug, answers }));
    } catch (e) {
      setError(registrationErrorSentence(e, "Your answers could not be scored. Try again."));
    } finally {
      setBusy(false);
    }
  }

  if (!pack) {
    // Neither the step's heading nor its submit button is drawn before the questions are: the
    // device script reads both as "the assessment is ready".
    return (
      <OnboardingFrame
        primary={
          loadProblem ? (
            <Button label="Try again" onPress={() => setReloadKey((k) => k + 1)} />
          ) : (
            <Button label="Loading assessment…" onPress={() => undefined} loading disabled />
          )
        }
      >
        {loadProblem ? (
          <Problem message={loadProblem} testID="onboarding-assessment-load-problem" />
        ) : (
          <>
            <SkeletonCard lines={4} />
            <SkeletonCard lines={4} />
          </>
        )}
      </OnboardingFrame>
    );
  }

  if (result?.passed) {
    return (
      <OnboardingFrame
        heading="Skill assessment"
        primary={
          <Button
            testID="onboarding-continue-training"
            label="Continue to training"
            loading={loading}
            onPress={() => {
              if (submitLock.current || loading) return;
              submitLock.current = true;
              void Promise.resolve(onPassed()).finally(() => {
                submitLock.current = false;
              });
            }}
          />
        }
      >
        <Banner
          tone="success"
          title="Assessment passed"
          message={`Score ${result.score}/${result.maxScore} · ${result.correctCount} of ${result.total} correct. Continue to training, then review and submit.`}
          testID="onboarding-assessment-passed"
        />
      </OnboardingFrame>
    );
  }

  return (
    <OnboardingFrame
      heading="Skill assessment"
      lead={`Choose one answer for each question. You need ${pack.passScore}% to continue.`}
      error={error}
      primary={<Button label={result ? "Retry assessment" : "Submit answers"} onPress={() => void submit()} loading={busy} />}
    >
      <View style={styles.meta}>
        <Pill label={pack.skillSlug} tone="leaf" />
        <T kind="smallStrong" tone="slate" numeric>
          {answered} of {questions.length} answered
        </T>
      </View>
      <View style={styles.track} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <View style={[styles.fill, { width: `${questions.length ? Math.round((answered / questions.length) * 100) : 0}%` }]} />
      </View>
      {result && !result.passed ? (
        <Banner tone="warning" title="Not passed yet" message={`Score ${result.score}/${result.maxScore}. You need ${pack.passScore}%. Check your answers and retry.`} testID="onboarding-assessment-failed" />
      ) : null}
      {questions.map((q, i) => (
        <Card key={q.id} style={styles.card}>
          <T kind="bodyStrong">
            {i + 1}. {q.prompt}
          </T>
          {q.options.map((opt) => (
            <Choice key={opt.id} block label={opt.label} selected={answers[q.id] === opt.id} onPress={() => setAnswers((prev) => ({ ...prev, [q.id]: opt.id }))} />
          ))}
        </Card>
      ))}
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  meta: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md },
  track: { height: space.xs, borderRadius: radius.pill, backgroundColor: color.well, overflow: "hidden" },
  fill: { height: "100%", borderRadius: radius.pill, backgroundColor: color.leaf },
  card: { gap: space.sm },
});
