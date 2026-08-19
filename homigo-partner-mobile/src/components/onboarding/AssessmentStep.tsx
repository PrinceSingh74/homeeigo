import { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { partnerRegistrationApi } from "@/services/partner-registration-api";
import { partnerColors } from "@/theme/colors";

type Question = { id: string; prompt: string; options: Array<{ id: string; label: string }> };

export function AssessmentStep({
  loading,
  onPassed,
}: {
  loading: boolean;
  onPassed: () => void | Promise<void>;
}) {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [skillSlug, setSkillSlug] = useState("general");
  const [passScore, setPassScore] = useState(60);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const submitLock = useRef(false);
  const [result, setResult] = useState<{
    passed: boolean;
    score: number;
    maxScore: number;
    correctCount: number;
    total: number;
  } | null>(null);

  useEffect(() => {
    setError(null);
    void partnerRegistrationApi
      .getAssessment()
      .then((pack) => {
        setQuestions(pack.questions);
        setSkillSlug(pack.skillSlug);
        setPassScore(pack.passScore);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Assessment could not be loaded."));
  }, [reloadKey]);

  const answered = questions.filter((q) => answers[q.id]).length;

  async function submit() {
    if (questions.some((q) => !answers[q.id])) {
      setError("Answer every question before submitting.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const scored = await partnerRegistrationApi.runAssessment({ skillSlug, answers });
      setResult(scored);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Assessment scoring failed.");
    } finally {
      setBusy(false);
    }
  }

  if (questions.length === 0 && !error) {
    return (
      <View style={styles.wrap}>
        <ActivityIndicator color={partnerColors.primary} />
        <Text style={styles.copy}>Loading assessment…</Text>
      </View>
    );
  }

  if (questions.length === 0 && error) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.error}>{error}</Text>
        <Pressable style={styles.ghost} onPress={() => setReloadKey((k) => k + 1)}>
          <Text style={styles.ghostText}>Retry loading assessment</Text>
        </Pressable>
      </View>
    );
  }

  if (result?.passed) {
    return (
      <View style={styles.wrap}>
        <View style={styles.pass}>
          <Text style={styles.passTitle}>Assessment passed</Text>
          <Text style={styles.copy}>
            Score {result.score}/{result.maxScore} · {result.correctCount} of {result.total} correct
          </Text>
          <Text style={styles.copy}>You can submit your application for HQ review.</Text>
        </View>
        <Pressable
          accessibilityRole="button"
          style={styles.button}
          disabled={loading}
          onPress={() => {
            if (submitLock.current || loading) return;
            submitLock.current = true;
            void Promise.resolve(onPassed()).finally(() => {
              submitLock.current = false;
            });
          }}
        >
          {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Submit application</Text>}
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.title}>Skill assessment</Text>
        <View style={styles.chip}>
          <Text style={styles.chipText}>{skillSlug}</Text>
        </View>
      </View>
      <Text style={styles.copy}>
        Short professional quiz. HOMEEIGO scores this — you need {passScore}% to continue.
      </Text>
      <View>
        <View style={styles.progressRow}>
          <Text style={styles.meta}>
            {answered} of {questions.length} answered
          </Text>
          <Text style={styles.meta}>Pass {passScore}%</Text>
        </View>
        <View style={styles.track}>
          <View
            style={[
              styles.fill,
              { width: `${questions.length ? Math.round((answered / questions.length) * 100) : 0}%` },
            ]}
          />
        </View>
      </View>
      {result && !result.passed ? (
        <View style={styles.warnBox}>
          <Text style={styles.warn}>
            Score {result.score}/{result.maxScore}. Review and retry.
          </Text>
        </View>
      ) : null}
      {questions.map((q, i) => (
        <View key={q.id} style={styles.card}>
          <Text style={styles.label}>
            {i + 1}. {q.prompt}
          </Text>
          {q.options.map((opt) => {
            const selected = answers[q.id] === opt.id;
            return (
              <Pressable
                key={opt.id}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                accessibilityLabel={opt.label}
                onPress={() => setAnswers((prev) => ({ ...prev, [q.id]: opt.id }))}
                style={[styles.option, selected && styles.optionOn]}
              >
                <Text style={[styles.optionText, selected && styles.optionTextOn]}>{opt.label}</Text>
              </Pressable>
            );
          })}
        </View>
      ))}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <Pressable accessibilityRole="button" style={styles.button} disabled={busy} onPress={() => void submit()}>
        {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>{result ? "Retry assessment" : "Submit answers"}</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  title: { fontSize: 22, fontWeight: "800", color: partnerColors.text, letterSpacing: -0.3, flex: 1 },
  chip: {
    borderRadius: 999,
    backgroundColor: "rgba(61,107,79,0.12)",
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  chipText: { fontSize: 11, fontWeight: "800", color: partnerColors.primary, textTransform: "uppercase" },
  copy: { color: partnerColors.textSecondary, lineHeight: 20, fontSize: 14 },
  progressRow: { flexDirection: "row", justifyContent: "space-between" },
  meta: { fontSize: 11, fontWeight: "700", color: partnerColors.textMuted },
  track: { marginTop: 6, height: 6, borderRadius: 999, backgroundColor: "rgba(61,107,79,0.12)", overflow: "hidden" },
  fill: { height: "100%", borderRadius: 999, backgroundColor: partnerColors.primary },
  warn: { color: "#92400e", fontWeight: "600", fontSize: 13, lineHeight: 18 },
  warnBox: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.4)",
    backgroundColor: "rgba(255,251,235,0.95)",
    padding: 12,
  },
  error: { color: partnerColors.danger, fontSize: 13 },
  pass: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.35)",
    backgroundColor: "rgba(236,253,245,0.95)",
    padding: 16,
    gap: 6,
  },
  passTitle: { fontWeight: "800", color: "#065f46", fontSize: 18 },
  card: {
    borderWidth: 1,
    borderColor: partnerColors.line,
    borderRadius: 16,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.92)",
    gap: 8,
  },
  label: { fontWeight: "700", color: partnerColors.text, lineHeight: 20 },
  option: {
    borderWidth: 1,
    borderColor: partnerColors.line,
    borderRadius: 12,
    padding: 10,
  },
  optionOn: { borderColor: partnerColors.primary, backgroundColor: "rgba(61,107,79,0.08)" },
  optionText: { color: partnerColors.text, fontSize: 13, lineHeight: 18 },
  optionTextOn: { fontWeight: "700" },
  ghost: {
    borderWidth: 1,
    borderColor: partnerColors.line,
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: "center",
  },
  ghostText: { fontWeight: "700", color: partnerColors.primary },
  button: {
    backgroundColor: partnerColors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonText: { color: "#fff", fontWeight: "700" },
});
