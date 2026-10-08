import { Wrench } from "lucide-react-native";
import { useEffect, useState } from "react";
import { StyleSheet } from "react-native";
import { Choice, ChoiceGroup, OnboardingFrame, Problem } from "@/components/onboarding/OnboardingFrame";
import { Button, Card, EmptyState, Field, Skeleton } from "@/components/ui";
import { ONBOARDING_CITIES } from "@/lib/onboarding-catalog";
import { ONBOARDING_LIMITS, digitsOnly, registrationErrorSentence } from "@/lib/onboarding-form";
import { partnerRegistrationApi } from "@/services/partner-registration-api";
import { space } from "@/theme/tokens";

type Catalog = { state: "loading" } | { state: "ready"; options: Array<{ id: string; label: string }> } | { state: "failed"; message: string };

/**
 * Step 2: services, city and experience. The service list is the server's
 * (`GET /register/service-options`); `POST /register/services` wants at least one service, a city
 * and 0–50 whole years.
 */
export function ServicesStep({
  serviceCategories,
  city,
  experienceYears,
  error,
  loading,
  onToggleService,
  onSelectCity,
  onExperience,
  onSubmit,
}: {
  serviceCategories: string[];
  city: string;
  experienceYears: string;
  error?: string;
  loading: boolean;
  onToggleService: (id: string) => void;
  onSelectCity: (city: string) => void;
  onExperience: (years: string) => void;
  onSubmit: () => void;
}) {
  const [catalog, setCatalog] = useState<Catalog>({ state: "loading" });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setCatalog({ state: "loading" });
    partnerRegistrationApi
      .serviceOptions()
      .then((data) => {
        if (!cancelled) setCatalog({ state: "ready", options: data.options ?? [] });
      })
      .catch((e) => {
        if (!cancelled) setCatalog({ state: "failed", message: registrationErrorSentence(e, "The list of services could not be loaded.") });
      });
    return () => {
      cancelled = true;
    };
  }, [reloadKey]);

  return (
    <OnboardingFrame
      heading="Services & location"
      lead="Which services do you provide?"
      error={error}
      primary={<Button testID="onboarding-save-continue" label="Save & continue" onPress={onSubmit} loading={loading} />}
    >
      <Card style={styles.card}>
        {catalog.state === "loading" ? (
          <>
            <Skeleton height={48} />
            <Skeleton height={48} width="70%" />
          </>
        ) : catalog.state === "failed" ? (
          <Problem message={catalog.message} onRetry={() => setReloadKey((k) => k + 1)} testID="onboarding-services-error" />
        ) : catalog.options.length === 0 ? (
          <EmptyState icon={Wrench} title="No services to choose yet" message="Services open for new partners will appear here." action={<Button label="Check again" variant="secondary" onPress={() => setReloadKey((k) => k + 1)} />} />
        ) : (
          <ChoiceGroup label="Services">
            {catalog.options.map((service) => (
              <Choice key={service.id} label={service.label} selected={serviceCategories.includes(service.id)} onPress={() => onToggleService(service.id)} />
            ))}
          </ChoiceGroup>
        )}
        <ChoiceGroup label="City">
          {ONBOARDING_CITIES.map((item) => (
            <Choice key={item} label={item} selected={city === item} onPress={() => onSelectCity(item)} />
          ))}
        </ChoiceGroup>
        <Field
          label="Years of experience"
          value={experienceYears}
          onChangeText={(v) => onExperience(digitsOnly(v, ONBOARDING_LIMITS.experienceYears))}
          help="Whole years, 0 to 50."
          keyboardType="number-pad"
          maxLength={ONBOARDING_LIMITS.experienceYears}
          autoComplete="off"
        />
      </Card>
    </OnboardingFrame>
  );
}

const styles = StyleSheet.create({
  card: { gap: space.lg },
});
