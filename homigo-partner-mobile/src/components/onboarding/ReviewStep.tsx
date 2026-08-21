import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from "react-native";
import { partnerRegistrationApi, type OnboardingReviewPayload } from "@/services/partner-registration-api";
import { partnerColors } from "@/theme/colors";
import type { MobileOnboardingStep } from "@/lib/onboarding-resume";

const EDIT: Record<string, MobileOnboardingStep> = {
  profile: "profile",
  services: "services",
  location: "location",
  availability: "availability",
  kyc: "kyc",
  documents: "documents",
  assessment: "assessment",
  training: "training",
};

export function ReviewStep({
  loading,
  onEdit,
  onSubmit,
}: {
  loading: boolean;
  onEdit: (step: MobileOnboardingStep) => void;
  onSubmit: () => void | Promise<void>;
}) {
  const [data, setData] = useState<OnboardingReviewPayload | null>(null);
  const [open, setOpen] = useState<string | null>("profile");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void partnerRegistrationApi
      .getReview()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load review"));
  }, []);

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Final review</Text>
      <Text style={styles.copy}>Check each section, then submit. HQ still validates readiness on the server.</Text>
      {(data?.sections ?? []).map((section) => {
        const expanded = open === section.id;
        return (
          <View key={section.id} style={styles.card}>
            <Pressable accessibilityRole="button" onPress={() => setOpen(expanded ? null : section.id)} style={styles.head}>
              <View style={{ flex: 1 }}>
                <Text style={styles.modTitle}>{section.label}</Text>
                <Text style={styles.meta}>{section.complete ? "Complete" : "Needs attention"}</Text>
              </View>
              <Text style={styles.chev}>{expanded ? "▾" : "▸"}</Text>
            </Pressable>
            {expanded ? (
              <View style={styles.body}>
                <Text style={styles.copy}>{section.summary || "No summary"}</Text>
                {EDIT[section.id] ? (
                  <Pressable onPress={() => onEdit(EDIT[section.id]!)} style={styles.ghost}>
                    <Text style={styles.ghostText}>{section.id === "assessment" || section.id === "training" ? "View" : "Edit"}</Text>
                  </Pressable>
                ) : null}
              </View>
            ) : null}
          </View>
        );
      })}
      {data && !data.canSubmit ? (
        <Text accessibilityRole="alert" style={styles.warn}>
          {data.submitBlockers.join(" ")}
        </Text>
      ) : null}
      {error ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        style={styles.button}
        disabled={loading || !data?.canSubmit}
        onPress={() => void onSubmit()}
      >
        {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Submit application</Text>}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12, paddingBottom: 24 },
  title: { fontSize: 20, fontWeight: "800", color: partnerColors.text, letterSpacing: -0.3 },
  copy: { color: partnerColors.textSecondary, lineHeight: 20 },
  card: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: partnerColors.line,
    backgroundColor: "rgba(255,255,255,0.92)",
    overflow: "hidden",
  },
  head: { flexDirection: "row", alignItems: "center", padding: 14, gap: 8 },
  modTitle: { fontWeight: "700", color: partnerColors.text },
  meta: { fontSize: 12, color: partnerColors.textMuted, fontWeight: "600", marginTop: 2 },
  chev: { fontSize: 16, color: partnerColors.textMuted },
  body: { paddingHorizontal: 14, paddingBottom: 14, gap: 8 },
  ghost: {
    alignSelf: "flex-start",
    borderWidth: 1,
    borderColor: partnerColors.line,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  ghostText: { fontWeight: "700", color: partnerColors.primary, fontSize: 13 },
  warn: { color: "#92400e", fontWeight: "600" },
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
