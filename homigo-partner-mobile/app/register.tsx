import { useEffect, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { PartnerScreen } from "@/components/PartnerScreen";
import { OnboardingProgressHeader } from "@/components/onboarding/OnboardingProgressHeader";
import { OnboardingStepper } from "@/components/onboarding/OnboardingStepper";
import { OnboardingField } from "@/components/onboarding/OnboardingField";
import { AccountStep, validateAccount } from "@/components/onboarding/AccountStep";
import { ServicesStep } from "@/components/onboarding/ServicesStep";
import { ProfileStep, validateProfile } from "@/components/onboarding/ProfileStep";
import { LocationStep } from "@/components/onboarding/LocationStep";
import { AvailabilityStep } from "@/components/onboarding/AvailabilityStep";
import { KycStep, validateKyc } from "@/components/onboarding/KycStep";
import { DocumentsStep } from "@/components/onboarding/DocumentsStep";
import { AssessmentStep } from "@/components/onboarding/AssessmentStep";
import {
  draftSection,
  MOBILE_STEP_LABELS,
  resolveMobileOnboardingStep,
  type MobileOnboardingStep,
} from "@/lib/onboarding-resume";
import { mapCityChoice, mapSkillToServiceId, MOBILE_STEPPER, stepperIdForStep } from "@/lib/onboarding-catalog";
import {
  clearApplicationInvite,
  getApplicationInvite,
  getRegistrationToken,
  setApplicationInvite,
} from "@/lib/registration-session";
import { partnerRegistrationApi } from "@/services/partner-registration-api";
import { partnerColors } from "@/theme/colors";

type BootPhase = "loading" | "ready" | "resume-sign-in";

const STEP_BACK: Partial<Record<MobileOnboardingStep, MobileOnboardingStep>> = {
  account: "welcome",
  otp: "account",
  services: "otp",
  profile: "services",
  location: "profile",
  availability: "location",
  kyc: "availability",
  documents: "kyc",
  assessment: "documents",
};

export default function RegisterScreen() {
  const [bootPhase, setBootPhase] = useState<BootPhase>("loading");
  const [step, setStep] = useState<MobileOnboardingStep>("welcome");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [restored, setRestored] = useState(false);
  const [percentComplete, setPercentComplete] = useState(0);
  const [resumeLabel, setResumeLabel] = useState("Welcome");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [changesNotes, setChangesNotes] = useState<string | null>(null);
  const [inviteWarning, setInviteWarning] = useState<string | null>(null);
  const [invite, setInvite] = useState<{
    name: string;
    firstName?: string;
    lastName?: string;
    skillInterest?: string | null;
    city?: string | null;
    phoneLast4?: string;
  } | null>(null);
  const params = useLocalSearchParams<{ invite?: string | string[] }>();

  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");
  const [devOtp, setDevOtp] = useState<string | undefined>();
  const [otp, setOtp] = useState("");
  const [resumePassword, setResumePassword] = useState("");
  const [stepError, setStepError] = useState<string | null>(null);

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    phoneNumber: "",
    password: "",
    confirmPassword: "",
    city: "",
    serviceCategories: [] as string[],
    experienceYears: "2",
    serviceRegions: "",
    serviceRadiusKm: "5",
    emergencyName: "",
    emergencyPhone: "",
    dateOfBirth: "",
    gender: "",
    workingHoursStart: "09:00",
    workingHoursEnd: "18:00",
    workingDays: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as string[],
    panNumber: "",
    aadharNumber: "",
    bankAccountNumber: "",
    bankAccountHolder: "",
    ifscCode: "",
    bankName: "",
  });

  function applyDraft(data: Record<string, unknown>) {
    const profile = draftSection(data, "profile");
    const location = draftSection(data, "location");
    const skills = draftSection(data, "skills");
    const services = draftSection(data, "services");
    const kyc = draftSection(data, "kyc");
    const availability = draftSection(data, "availability");
    const categories = Array.isArray(services.serviceCategories)
      ? (services.serviceCategories as string[])
      : mapSkillToServiceId(skills.primarySkill ? String(skills.primarySkill) : null)
        ? [mapSkillToServiceId(String(skills.primarySkill))!]
        : [];
    setForm((prev) => ({
      ...prev,
      city: location.city
        ? String(location.city)
        : services.city
          ? String(services.city)
          : prev.city,
      serviceCategories: categories.length ? categories : prev.serviceCategories,
      serviceRegions: Array.isArray(location.serviceRegions)
        ? (location.serviceRegions as string[]).join(", ")
        : prev.serviceRegions,
      serviceRadiusKm: location.serviceRadiusKm ? String(location.serviceRadiusKm) : prev.serviceRadiusKm,
      experienceYears: String(skills.experienceYears ?? services.experienceYears ?? prev.experienceYears),
      emergencyName: profile.emergencyContactName ? String(profile.emergencyContactName) : prev.emergencyName,
      emergencyPhone: profile.emergencyContactPhone ? String(profile.emergencyContactPhone) : prev.emergencyPhone,
      dateOfBirth: profile.dateOfBirth ? String(profile.dateOfBirth) : prev.dateOfBirth,
      gender: profile.gender ? String(profile.gender) : prev.gender,
      workingHoursStart: availability.workingHoursStart ? String(availability.workingHoursStart) : prev.workingHoursStart,
      workingHoursEnd: availability.workingHoursEnd ? String(availability.workingHoursEnd) : prev.workingHoursEnd,
      workingDays: Array.isArray(availability.workingDays)
        ? (availability.workingDays as string[])
        : prev.workingDays,
      panNumber: kyc.panNumber ? String(kyc.panNumber) : prev.panNumber,
      aadharNumber: kyc.aadharNumber ? String(kyc.aadharNumber) : prev.aadharNumber,
      bankAccountNumber: kyc.bankAccountNumber ? String(kyc.bankAccountNumber) : prev.bankAccountNumber,
      bankAccountHolder: kyc.bankAccountHolder ? String(kyc.bankAccountHolder) : prev.bankAccountHolder,
      ifscCode: kyc.ifscCode ? String(kyc.ifscCode) : prev.ifscCode,
      bankName: kyc.bankName ? String(kyc.bankName) : prev.bankName,
    }));
  }

  function goTo(next: MobileOnboardingStep) {
    setStep(next);
    setResumeLabel(MOBILE_STEP_LABELS[next]);
    const idx = MOBILE_STEPPER.findIndex((s) => s.id === stepperIdForStep(next));
    setPercentComplete(Math.round(((idx + 1) / MOBILE_STEPPER.length) * 100));
    setFieldErrors({});
    setStepError(null);
    setError(null);
  }

  function applyProgress(progress: {
    completedSteps: string[];
    percentComplete: number;
    draftData?: Record<string, unknown>;
    lastSavedAt?: string | null;
    resumeLabel?: string;
    submitted?: boolean;
    userId?: string;
    email?: string;
    changesRequested?: boolean;
    changesRequestedStep?: string | null;
    changesRequestedNotes?: string | null;
    canResume?: boolean;
  }) {
    const isChangesRequested = Boolean(progress.changesRequested);
    if (progress.canResume === false && !isChangesRequested) {
      setBootPhase("resume-sign-in");
      return;
    }
    const next = resolveMobileOnboardingStep(
      progress.completedSteps,
      progress.submitted,
      progress.changesRequestedStep,
    );
    setStep(next);
    setPercentComplete(progress.percentComplete);
    setResumeLabel(progress.resumeLabel ?? MOBILE_STEP_LABELS[next]);
    setLastSavedAt(progress.lastSavedAt ?? null);
    applyDraft(progress.draftData ?? {});
    setChangesNotes(isChangesRequested ? progress.changesRequestedNotes ?? null : null);
    if (progress.userId) setUserId(progress.userId);
    if (progress.email) setEmail(progress.email);
    setRestored(true);
    setBootPhase("ready");
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const rawInvite = Array.isArray(params.invite) ? params.invite[0] : params.invite;
      if (rawInvite) await setApplicationInvite(rawInvite);
      const inviteToken = rawInvite || (await getApplicationInvite());
      let invalidInvite = false;
      if (inviteToken) {
        try {
          const preview = await partnerRegistrationApi.getInvite(inviteToken);
          if (!cancelled) {
            setInvite(preview);
            setInviteWarning(null);
            const skillId = mapSkillToServiceId(preview.skillInterest);
            const city = mapCityChoice(preview.city);
            setForm((prev) => ({
              ...prev,
              firstName: preview.firstName || prev.firstName,
              lastName: preview.lastName || prev.lastName,
              city: city || prev.city,
              serviceCategories: skillId ? [skillId] : prev.serviceCategories,
            }));
          }
        } catch (err) {
          invalidInvite = true;
          if (!cancelled) {
            const message = err instanceof Error ? err.message : "";
            setInviteWarning(
              /reach backend|network|failed to fetch/i.test(message)
                ? "Could not verify this invite. Check your connection and retry."
                : "This invite is invalid or expired. You can still apply.",
            );
          }
        }
      }
      const token = await getRegistrationToken();
      if (!token) {
        if (!cancelled) {
          setBootPhase("ready");
          if (inviteToken && !invalidInvite) setStep("account");
        }
        return;
      }
      try {
        const progress = await partnerRegistrationApi.getProgress();
        if (!cancelled) applyProgress(progress);
      } catch {
        if (!cancelled) setBootPhase("resume-sign-in");
      }
    })().catch(() => {
      if (!cancelled) setBootPhase("ready");
    });
    return () => {
      cancelled = true;
    };
  }, []);

  async function run(fn: () => Promise<void>) {
    setLoading(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Network unavailable — your progress is saved.");
    } finally {
      setLoading(false);
    }
  }

  async function handleResumeSignIn() {
    await run(async () => {
      const progress = await partnerRegistrationApi.resumeApplication({ email, password: resumePassword });
      applyProgress(progress);
    });
  }

  const showStepper = bootPhase === "ready" && step !== "welcome";
  const backStep = STEP_BACK[step];

  if (bootPhase === "loading") {
    return (
      <PartnerScreen title="Become a HOMEEIGO Partner" subtitle="Loading your application…">
        <View style={styles.loadingBox}>
          <ActivityIndicator color={partnerColors.primary} />
        </View>
      </PartnerScreen>
    );
  }

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <PartnerScreen
        title="Become a HOMEEIGO Partner"
        subtitle="Complete your application — progress is saved automatically."
        showBack={Boolean(backStep) && bootPhase === "ready"}
        onBack={() => backStep && goTo(backStep)}
      >
        <View style={styles.body}>
          {showStepper ? <OnboardingStepper currentStep={step} /> : null}

          {step !== "welcome" && step !== "done" ? (
            <OnboardingProgressHeader
              percentComplete={percentComplete}
              resumeLabel={resumeLabel}
              lastSavedAt={lastSavedAt}
              restored={restored}
            />
          ) : null}

          {error ? (
            <Text accessibilityRole="alert" style={styles.error}>
              {error}
            </Text>
          ) : null}

          {changesNotes ? (
            <View style={styles.changesBanner}>
              <Text style={styles.changesTitle}>HQ requested updates</Text>
              <Text style={styles.changesCopy}>{changesNotes}</Text>
              <Text style={styles.changesStep}>Continue from {resumeLabel}</Text>
            </View>
          ) : null}

          {bootPhase === "resume-sign-in" ? (
            <View style={styles.resumeCard}>
              <Text style={styles.resumeTitle}>Continue your application</Text>
              <Text style={styles.resumeCopy}>Sign in with the email and password from your application.</Text>
              <OnboardingField
                label="Email"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <OnboardingField
                label="Password"
                value={resumePassword}
                onChangeText={setResumePassword}
                secureTextEntry
              />
              <Pressable accessibilityRole="button" style={styles.button} onPress={() => void handleResumeSignIn()}>
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Continue application</Text>}
              </Pressable>
            </View>
          ) : null}

          {inviteWarning && (step === "welcome" || step === "account") && bootPhase === "ready" ? (
            <View accessibilityRole="alert" style={styles.changesBanner}>
              <Text style={styles.changesTitle}>Invite could not be used</Text>
              <Text style={styles.changesCopy}>{inviteWarning}</Text>
            </View>
          ) : null}

          {invite && (step === "welcome" || step === "account") && bootPhase === "ready" ? (
            <View style={styles.inviteBanner}>
              <Text style={styles.inviteTitle}>HOMEEIGO invited {invite.name}</Text>
              <Text style={styles.inviteCopy}>
                {invite.skillInterest ? `${invite.skillInterest} · ` : ""}
                {invite.city ?? "Complete your partner application."}
                {invite.phoneLast4
                  ? ` Use the mobile ending in ${invite.phoneLast4}.`
                  : " Use the same mobile number HQ has on file."}
              </Text>
            </View>
          ) : null}

          {step === "welcome" && bootPhase === "ready" ? (
            <>
              <Text style={styles.copy}>
                Same onboarding as Partner Web — account, services, KYC, documents, then a short skill assessment.
              </Text>
              <Pressable accessibilityRole="button" style={styles.button} onPress={() => goTo("account")}>
                <Text style={styles.buttonText}>{invite ? "Continue invite" : "Start application"}</Text>
              </Pressable>
              <Pressable accessibilityRole="button" onPress={() => setBootPhase("resume-sign-in")} style={styles.secondaryBtn}>
                <Text style={styles.secondaryBtnText}>Continue existing application</Text>
              </Pressable>
            </>
          ) : null}

          {step === "account" && bootPhase === "ready" && restored ? (
            <View style={styles.resumeCard}>
              <Text style={styles.resumeTitle}>Account verified</Text>
              <Text style={styles.resumeCopy}>Continue with the next steps of your application.</Text>
              <Pressable accessibilityRole="button" style={styles.button} onPress={() => goTo("services")}>
                <Text style={styles.buttonText}>Continue from {resumeLabel}</Text>
              </Pressable>
            </View>
          ) : null}

          {step === "account" && bootPhase === "ready" && !restored ? (
            <AccountStep
              form={form}
              email={email}
              errors={fieldErrors}
              loading={loading}
              onEmailChange={setEmail}
              onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
              onSubmit={() => {
                const next = validateAccount(form, email);
                setFieldErrors(next);
                if (Object.keys(next).length) return;
                void run(async () => {
                  const res = await partnerRegistrationApi.step1({
                    email,
                    phoneNumber: form.phoneNumber,
                    firstName: form.firstName,
                    lastName: form.lastName,
                    password: form.password,
                    confirmPassword: form.confirmPassword,
                  });
                  setUserId(res.userId);
                  setDevOtp(res.devOtp);
                  goTo("otp");
                });
              }}
            />
          ) : null}

          {step === "otp" ? (
            <>
              <Text style={styles.stepTitle}>Verify mobile</Text>
              <Text style={styles.copy}>Enter the 6-digit OTP sent to +91{form.phoneNumber}.</Text>
              {devOtp ? <Text style={styles.hint}>Dev OTP: {devOtp}</Text> : null}
              <OnboardingField label="OTP" value={otp} placeholder="6-digit OTP" keyboardType="numeric" maxLength={6} onChangeText={setOtp} />
              <Pressable
                accessibilityRole="button"
                style={styles.button}
                disabled={loading || otp.length < 6}
                onPress={() =>
                  void run(async () => {
                    await partnerRegistrationApi.verifyOtp({
                      email,
                      otp,
                      userId,
                      inviteToken: (await getApplicationInvite()) ?? undefined,
                    });
                    goTo("services");
                  })
                }
              >
                {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Verify OTP</Text>}
              </Pressable>
            </>
          ) : null}

          {step === "services" ? (
            <ServicesStep
              serviceCategories={form.serviceCategories}
              city={form.city}
              experienceYears={form.experienceYears}
              error={stepError ?? undefined}
              loading={loading}
              onToggleService={(id) =>
                setForm((prev) => ({
                  ...prev,
                  serviceCategories: prev.serviceCategories.includes(id)
                    ? prev.serviceCategories.filter((s) => s !== id)
                    : [...prev.serviceCategories, id],
                }))
              }
              onSelectCity={(city) => setForm((prev) => ({ ...prev, city }))}
              onExperience={(experienceYears) => setForm((prev) => ({ ...prev, experienceYears }))}
              onSubmit={() => {
                if (!form.serviceCategories.length) {
                  setStepError("Select at least one service");
                  return;
                }
                if (!form.city) {
                  setStepError("Select a city");
                  return;
                }
                setStepError(null);
                void run(async () => {
                  await partnerRegistrationApi.saveServices({
                    serviceCategories: form.serviceCategories,
                    city: form.city,
                    experienceYears: Number(form.experienceYears) || 0,
                  });
                  await partnerRegistrationApi.saveSkills({
                    primarySkill: form.serviceCategories[0],
                    secondarySkills: form.serviceCategories.slice(1),
                    experienceYears: Number(form.experienceYears) || 0,
                  });
                  goTo("profile");
                });
              }}
            />
          ) : null}

          {step === "profile" ? (
            <ProfileStep
              dateOfBirth={form.dateOfBirth}
              gender={form.gender}
              emergencyName={form.emergencyName}
              emergencyPhone={form.emergencyPhone}
              errors={fieldErrors}
              loading={loading}
              onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
              onSubmit={() => {
                const next = validateProfile(form);
                setFieldErrors(next);
                if (Object.keys(next).length) return;
                void run(async () => {
                  await partnerRegistrationApi.saveProfile({
                    emergencyContactName: form.emergencyName,
                    emergencyContactPhone: form.emergencyPhone,
                    dateOfBirth: form.dateOfBirth,
                    gender: form.gender,
                  });
                  goTo("location");
                });
              }}
            />
          ) : null}

          {step === "location" ? (
            <LocationStep
              city={form.city}
              serviceRegions={form.serviceRegions}
              serviceRadiusKm={form.serviceRadiusKm}
              error={stepError ?? undefined}
              loading={loading}
              onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
              onSubmit={() => {
                if (!form.city.trim()) {
                  setStepError("Enter your base city");
                  return;
                }
                const regions = form.serviceRegions
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean);
                setStepError(null);
                void run(async () => {
                  await partnerRegistrationApi.saveLocation({
                    city: form.city.trim(),
                    serviceRegions: regions.length ? regions : [form.city.trim()],
                    serviceRadiusKm: Math.min(50, Math.max(1, Number(form.serviceRadiusKm) || 5)),
                  });
                  goTo("availability");
                });
              }}
            />
          ) : null}

          {step === "availability" ? (
            <AvailabilityStep
              workingHoursStart={form.workingHoursStart}
              workingHoursEnd={form.workingHoursEnd}
              workingDays={form.workingDays}
              error={stepError ?? undefined}
              loading={loading}
              onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
              onToggleDay={(day) =>
                setForm((prev) => ({
                  ...prev,
                  workingDays: prev.workingDays.includes(day)
                    ? prev.workingDays.filter((d) => d !== day)
                    : [...prev.workingDays, day],
                }))
              }
              onSubmit={() => {
                if (form.workingDays.length === 0) {
                  setStepError("Select at least one working day.");
                  return;
                }
                setStepError(null);
                void run(async () => {
                  await partnerRegistrationApi.saveAvailability({
                    workingHoursStart: form.workingHoursStart || "09:00",
                    workingHoursEnd: form.workingHoursEnd || "18:00",
                    workingDays: form.workingDays,
                  });
                  goTo("kyc");
                });
              }}
            />
          ) : null}

          {step === "kyc" ? (
            <KycStep
              panNumber={form.panNumber}
              aadharNumber={form.aadharNumber}
              bankAccountNumber={form.bankAccountNumber}
              bankAccountHolder={form.bankAccountHolder}
              ifscCode={form.ifscCode}
              bankName={form.bankName}
              errors={fieldErrors}
              loading={loading}
              onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
              onSubmit={() => {
                const next = validateKyc(form);
                setFieldErrors(next);
                if (Object.keys(next).length) return;
                void run(async () => {
                  await partnerRegistrationApi.saveKyc({
                    panNumber: form.panNumber.trim().toUpperCase() || undefined,
                    aadharNumber: form.aadharNumber.trim() || undefined,
                    bankAccountNumber: form.bankAccountNumber.trim() || undefined,
                    bankAccountHolder: form.bankAccountHolder.trim() || undefined,
                    ifscCode: form.ifscCode.trim().toUpperCase() || undefined,
                    bankName: form.bankName.trim() || undefined,
                  });
                  goTo("documents");
                });
              }}
            />
          ) : null}

          {step === "documents" ? (
            <DocumentsStep
              loading={loading}
              onContinue={(uploaded) =>
                void run(async () => {
                  await partnerRegistrationApi.completeDocuments(uploaded);
                  goTo("assessment");
                })
              }
            />
          ) : null}

          {step === "assessment" ? (
            <AssessmentStep
              loading={loading}
              onPassed={() =>
                run(async () => {
                  await partnerRegistrationApi.submit();
                  await clearApplicationInvite();
                  goTo("done");
                  setPercentComplete(100);
                })
              }
            />
          ) : null}

          {step === "done" ? (
            <>
              <View style={styles.doneCard}>
                <Text style={styles.doneTitle}>Application submitted</Text>
                <Text style={styles.copy}>
                  HQ will review your documents, KYC, and assessment. Typical turnaround is 1–2 business days.
                </Text>
              </View>
              <Pressable accessibilityRole="button" style={styles.button} onPress={() => router.replace("/login")}>
                <Text style={styles.buttonText}>Back to Sign In</Text>
              </Pressable>
            </>
          ) : null}

          {step === "welcome" || step === "account" || step === "done" ? (
            <Pressable accessibilityRole="button" onPress={() => router.replace("/login")} style={styles.linkWrap}>
              <Text style={styles.link}>Already a partner? Sign in</Text>
            </Pressable>
          ) : null}
        </View>
      </PartnerScreen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  body: { paddingBottom: 24, gap: 12 },
  loadingBox: { paddingVertical: 48, alignItems: "center" },
  copy: { color: partnerColors.textSecondary, lineHeight: 20 },
  stepTitle: { fontSize: 20, fontWeight: "800", color: partnerColors.text, letterSpacing: -0.3 },
  button: {
    marginTop: 8,
    backgroundColor: partnerColors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  buttonText: { color: "#fff", fontWeight: "700" },
  secondaryBtn: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: partnerColors.line,
    paddingVertical: 14,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.85)",
  },
  secondaryBtnText: { color: partnerColors.primary, fontWeight: "700" },
  error: { color: partnerColors.danger, fontSize: 13 },
  changesBanner: {
    marginBottom: 4,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(245,158,11,0.45)",
    backgroundColor: "rgba(255,251,235,0.95)",
    padding: 14,
    gap: 6,
  },
  changesTitle: { fontWeight: "700", color: "#92400e", fontSize: 14 },
  changesCopy: { color: "#78350f", fontSize: 13, lineHeight: 18 },
  changesStep: { color: "#b45309", fontSize: 12, fontWeight: "600" },
  inviteBanner: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(61,107,79,0.28)",
    backgroundColor: "rgba(236,253,245,0.92)",
    padding: 14,
    gap: 4,
  },
  inviteTitle: { fontWeight: "700", color: "#065f46", fontSize: 14 },
  inviteCopy: { color: "#047857", fontSize: 13, lineHeight: 18 },
  hint: { color: partnerColors.textMuted, fontSize: 12 },
  linkWrap: { marginTop: 16, alignItems: "center" },
  link: { color: partnerColors.primary, fontWeight: "600" },
  resumeCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(37,99,235,0.2)",
    backgroundColor: "rgba(255,255,255,0.92)",
    padding: 16,
    gap: 10,
  },
  resumeTitle: { fontSize: 18, fontWeight: "700", color: partnerColors.text },
  resumeCopy: { fontSize: 13, color: partnerColors.textSecondary, lineHeight: 18 },
  doneCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(16,185,129,0.35)",
    backgroundColor: "rgba(236,253,245,0.95)",
    padding: 16,
    gap: 8,
  },
  doneTitle: { fontWeight: "800", color: "#065f46", fontSize: 18 },
});
