import { AlertTriangle, Check, ChevronDown, ChevronRight } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { OnboardingFrame, Problem } from "@/components/onboarding/OnboardingFrame";
import { Banner, Button, Card, Pill, SkeletonCard, T } from "@/components/ui";
import { registrationErrorSentence } from "@/lib/onboarding-form";
import type { MobileOnboardingStep } from "@/lib/onboarding-resume";
import { partnerRegistrationApi, type OnboardingReviewPayload } from "@/services/partner-registration-api";
import { color, radius, space, touch } from "@/theme/tokens";

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

/**
 * Step 10: the server's own summary of each section (`GET /onboarding/review`). Whether the
 * application can be submitted, and what stops it, are the server's `canSubmit` and
 * `submitBlockers`.
 */
export function ReviewStep({ loading, onEdit, onSubmit }: { loading: boolean; onEdit: (step: MobileOnboardingStep) => void; onSubmit: () => void | Promise<void> }) {
  const [data, setData] = useState<OnboardingReviewPayload | null>(null);
  const [open, setOpen] = useState<string | null>("profile");
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadProblem(null);
    partnerRegistrationApi
      .getReview()
      .then((next) => {
        if (!cancelled) setData(next);
      })
      .catch((e) => {
        if (!cancelled) setLoadProblem(registrationErrorSentence(e, "Your application summary could not be loaded."));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  const blockers = data && !data.canSubmit ? data.submitBlockers.filter(Boolean) : [];

  return (
    <OnboardingFrame
      heading="Final review"
      lead="Check each section, then submit your application."
      primary={<Button testID="onboarding-submit" label="Submit application" onPress={() => void onSubmit()} loading={loading} disabled={!data?.canSubmit} />}
    >
      {loadProblem ? (
        <Problem message={loadProblem} onRetry={() => setReloadKey((k) => k + 1)} testID="onboarding-review-load-problem" />
      ) : !data ? (
        <>
          <SkeletonCard lines={1} />
          <SkeletonCard lines={1} />
          <SkeletonCard lines={1} />
        </>
      ) : (
        <>
          {blockers.length ? <Banner tone="warning" title="Not ready to submit yet" message={blockers.join(" ")} testID="onboarding-submit-blockers" /> : null}
          {data.sections.map((section) => {
            const expanded = open === section.id;
            const target = EDIT[section.id];
            const verb = section.id === "assessment" || section.id === "training" ? "View" : "Edit";
            return (
              <Card key={section.id} padded={false} style={styles.card}>
                <Pressable
                  onPress={() => setOpen(expanded ? null : section.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`${section.label}, ${section.complete ? "complete" : "needs attention"}`}
                  accessibilityState={{ expanded }}
                  style={({ pressed }) => [styles.head, pressed ? styles.headPressed : null]}
                >
                  <View style={styles.headText}>
                    <T kind="bodyStrong">{section.label}</T>
                    {section.complete ? <Pill label="Complete" tone="success" icon={Check} /> : <Pill label="Needs attention" tone="warning" icon={AlertTriangle} />}
                  </View>
                  {expanded ? <ChevronDown color={color.mist} size={20} /> : <ChevronRight color={color.mist} size={20} />}
                </Pressable>
                {expanded ? (
                  <View style={styles.body}>
                    <T kind="body" tone="slate">
                      {section.summary || "No details to show."}
                    </T>
                    {target ? <Button label={verb} variant="secondary" onPress={() => onEdit(target)} /> : null}
                  </View>
                ) : null}
              </Card>
            );
          })}
        </>
      )}
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  card: { overflow: "hidden" },
  head: { minHeight: touch.min + 8, flexDirection: "row", alignItems: "center", gap: space.md, padding: space.lg, borderRadius: radius.card },
  headPressed: { backgroundColor: color.well },
  headText: { flex: 1, gap: space.sm },
  body: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md },
});
