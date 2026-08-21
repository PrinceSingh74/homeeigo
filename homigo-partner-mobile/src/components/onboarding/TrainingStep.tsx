import { useEffect, useState } from "react";
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { partnerRegistrationApi, type OnboardingTrainingPayload } from "@/services/partner-registration-api";
import { partnerColors } from "@/theme/colors";

export function TrainingStep({
  loading,
  onContinue,
}: {
  loading: boolean;
  onContinue: () => void | Promise<void>;
}) {
  const [data, setData] = useState<OnboardingTrainingPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    void partnerRegistrationApi
      .getTraining()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load training"));
  }, []);

  const total = data?.requiredModules || data?.modules.length || 0;
  const done = data?.completedCount ?? 0;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Partner training</Text>
      <Text style={styles.copy}>
        Same Academy as Partner Web. Required for activation, not for submit.
      </Text>
      <View style={styles.progress}>
        <Text style={styles.progressTitle}>
          {done} / {total || "—"} modules complete
        </Text>
        <Text style={styles.meta}>
          {data?.trainingComplete ? "Training completed" : done > 0 ? "Training in progress" : "Not started"}
        </Text>
        <Text style={styles.meta}>Required before activation: {data?.requiredForActivation ? "Yes" : "No"}</Text>
      </View>
      {(data?.modules ?? []).map((mod) => (
        <View key={mod.id} style={styles.card}>
          <Text style={styles.modTitle}>{mod.title}</Text>
          <Text style={styles.meta}>{mod.contentType}{mod.completedAt ? " · Completed" : " · Not started"}</Text>
          {mod.body ? <Text style={styles.body}>{mod.body.slice(0, 180)}</Text> : null}
          <View style={styles.row}>
            {mod.contentUrl ? (
              <Pressable onPress={() => void Linking.openURL(mod.contentUrl!)} style={styles.ghost}>
                <Text style={styles.ghostText}>Open content</Text>
              </Pressable>
            ) : null}
            {!mod.completedAt ? (
              <Pressable
                accessibilityRole="button"
                disabled={busyId === mod.id}
                onPress={() => {
                  setBusyId(mod.id);
                  void partnerRegistrationApi
                    .completeTrainingModule(mod.id)
                    .then(setData)
                    .catch((e) => setError(e instanceof Error ? e.message : "Could not save"))
                    .finally(() => setBusyId(null));
                }}
                style={styles.ghost}
              >
                <Text style={styles.ghostText}>{busyId === mod.id ? "Saving…" : "Mark complete"}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      ))}
      {data && data.modules.length === 0 ? (
        <Text style={styles.copy}>No published modules yet. You can continue to review.</Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <Pressable accessibilityRole="button" style={styles.button} disabled={loading} onPress={() => void onContinue()}>
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Continue to review</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12 },
  title: { fontSize: 20, fontWeight: "800", color: partnerColors.text, letterSpacing: -0.3 },
  copy: { color: partnerColors.textSecondary, lineHeight: 20 },
  progress: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: partnerColors.line,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.92)",
    gap: 4,
  },
  progressTitle: { fontWeight: "800", color: partnerColors.text },
  meta: { fontSize: 12, color: partnerColors.textMuted, fontWeight: "600" },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: partnerColors.line,
    padding: 14,
    backgroundColor: "rgba(255,255,255,0.92)",
    gap: 6,
  },
  modTitle: { fontWeight: "700", color: partnerColors.text },
  body: { color: partnerColors.textSecondary, fontSize: 13, lineHeight: 18 },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  ghost: {
    borderWidth: 1,
    borderColor: partnerColors.line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  ghostText: { fontWeight: "700", color: partnerColors.primary, fontSize: 13 },
  error: { color: partnerColors.danger, fontSize: 13 },
  button: {
    backgroundColor: partnerColors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: "#fff", fontWeight: "700" },
});
