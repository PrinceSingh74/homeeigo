import { useEffect, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { CheckCircle2 } from "lucide-react-native";
import { BackHandler, StyleSheet, View } from "react-native";
import { PartnerScreen } from "@/components/PartnerScreen";
import { AccountStep } from "@/components/onboarding/AccountStep";
import { AssessmentStep } from "@/components/onboarding/AssessmentStep";
import { AvailabilityStep } from "@/components/onboarding/AvailabilityStep";
import { DocumentsStep } from "@/components/onboarding/DocumentsStep";
import { KycStep } from "@/components/onboarding/KycStep";
import { LocationStep } from "@/components/onboarding/LocationStep";
import { OnboardingFrame, OnboardingFrameProvider, SIGN_UP_TITLE, TextNamedPrimaryButton, type OnboardingFrameValue } from "@/components/onboarding/OnboardingFrame";
import { ProfileStep } from "@/components/onboarding/ProfileStep";
import { ReviewStep } from "@/components/onboarding/ReviewStep";
import { ServicesStep } from "@/components/onboarding/ServicesStep";
import { TrainingStep } from "@/components/onboarding/TrainingStep";
import { Banner, Button, Card, Field, SkeletonCard, T } from "@/components/ui";
import { OFFLINE_SENTENCE } from "@/lib/error-sentence";
import { mapCityChoice, mapSkillToServiceId } from "@/lib/onboarding-catalog";
import { ONBOARDING_LIMITS, accountAwaitsOtp, digitsOnly, type CreatedAccount, registrationErrorSentence, stepIndicatorText, stepPosition, validateAccount, validateKyc, validateProfile } from "@/lib/onboarding-form";
import { draftSection, formatLastSaved, resolveMobileOnboardingStep, type MobileOnboardingStep } from "@/lib/onboarding-resume";
import {
  clearApplicationInvite,
  getApplicationInvite,
  getPendingReferralCode,
  getRegistrationToken,
  setApplicationInvite,
  setPendingReferralCode,
} from "@/lib/registration-session";
import { partnerRegistrationApi } from "@/services/partner-registration-api";
import { color, radius, space } from "@/theme/tokens";

type BootPhase = "loading" | "ready" | "resume-sign-in";

const STEP_BACK: Partial<Record<MobileOnboardingStep, MobileOnboardingStep>> = {
  account: "welcome",
  otp: "account",
  // No way back from Services: the mobile is verified by then, and the OTP step can only answer
  // "No valid OTP found" a second time, with no way forward again.
  profile: "services",
  location: "profile",
  availability: "location",
  kyc: "availability",
  documents: "kyc",
  assessment: "documents",
  training: "assessment",
  review: "training",
};

const FIELDS_NEED_FIXING = "Some details need fixing. Check the fields marked above.";

export default function RegisterScreen() {
  const [bootPhase, setBootPhase] = useState<BootPhase>("loading");
  const [bootKey, setBootKey] = useState(0);
  const [step, setStep] = useState<MobileOnboardingStep>("welcome");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [restored, setRestored] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [changesNotes, setChangesNotes] = useState<string | null>(null);
  const [inviteWarning, setInviteWarning] = useState<{ message: string; retry: boolean } | null>(null);
  const [invite, setInvite] = useState<{
    name: string;
    firstName?: string;
    lastName?: string;
    skillInterest?: string | null;
    city?: string | null;
    phoneLast4?: string;
  } | null>(null);
  const params = useLocalSearchParams<{ invite?: string | string[]; ref?: string | string[] }>();

  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");
  const [devOtp, setDevOtp] = useState<string | undefined>();
  /** The account step 1 created in this sitting, still waiting for its OTP. */
  const [createdAccount, setCreatedAccount] = useState<CreatedAccount | null>(null);
  const [otp, setOtp] = useState("");
  const [resumePassword, setResumePassword] = useState("");
  const [stepError, setStepError] = useState<string | null>(null);
  /** What the hardware back button does on the screen now showing; null leaves it to the system. */
  const hardwareBack = useRef<(() => void) | null>(null);
  const [returnToReview, setReturnToReview] = useState(false);

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
    latitude: "",
    longitude: "",
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
      latitude: location.baseLatitude ? String(location.baseLatitude) : prev.latitude,
      longitude: location.baseLongitude ? String(location.baseLongitude) : prev.longitude,
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
    // The "saved" line is the server's timestamp for the step the application was resumed at; once
    // the applicant moves, it no longer describes what is on screen.
    setLastSavedAt(null);
    setFieldErrors({});
    setStepError(null);
    setError(null);
  }

  function afterSave(next: MobileOnboardingStep) {
    if (returnToReview) {
      setReturnToReview(false);
      goTo("review");
      return;
    }
    goTo(next);
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
    if (progress.submitted && !isChangesRequested) {
      setStep("done");
      setLastSavedAt(null);
      setChangesNotes(null);
      if (progress.userId) setUserId(progress.userId);
      if (progress.email) setEmail(progress.email);
      setRestored(true);
      setBootPhase("ready");
      return;
    }
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
      const rawRef = Array.isArray(params.ref) ? params.ref[0] : params.ref;
      if (rawRef) await setPendingReferralCode(rawRef);
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
          const sentence = registrationErrorSentence(err, "This invite is invalid or expired.");
          const unreachable = sentence === OFFLINE_SENTENCE;
          // Only an invite the server refused is thrown away. One that could not be checked (no
          // connection) is kept, so it is still sent with the OTP once the connection is back.
          if (!unreachable) await clearApplicationInvite();
          if (!cancelled) {
            setInvite(null);
            setInviteWarning(
              unreachable
                ? { message: "Could not verify this invite. Check your connection and retry.", retry: true }
                : { message: `${sentence}${/[.!?]$/.test(sentence) ? "" : "."} You can still apply.`, retry: false },
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
  }, [params.invite, params.ref, bootKey]);

  async function run(fn: () => Promise<void>) {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      // The server's own sentence; "You're offline…" when there was no answer at all.
      setError(registrationErrorSentence(e, "That did not go through. Try again."));
    } finally {
      setLoading(false);
    }
  }

  async function handleResumeSignIn() {
    await run(async () => {
      const progress = await partnerRegistrationApi.resumeApplication({ email, password: resumePassword });
      // The account was created but its phone was never verified: the server has sent a new OTP.
      if (progress.nextStep === "verify-otp") {
        setUserId(progress.userId);
        if (progress.email) setEmail(progress.email);
        setDevOtp(progress.devOtp);
        setBootPhase("ready");
        goTo("otp");
        return;
      }
      applyProgress({ ...progress, completedSteps: progress.completedSteps ?? [], percentComplete: progress.percentComplete ?? 0 });
    });
  }

  const goToSignIn = () => router.replace("/login");

  // Android's back button does what the on-screen Back does. Left to the system it closed the whole
  // application form: at the OTP step that stranded an account that was created but not yet
  // verified, which "Continue existing application" then refuses. Where there is no step to go
  // back to (the first screen, or a step that cannot be undone) the system's back still applies.
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      const back = hardwareBack.current;
      if (!back) return false;
      back();
      return true;
    });
    return () => sub.remove();
  }, []);
  hardwareBack.current = null;

  if (bootPhase === "loading") {
    return (
      <PartnerScreen title={SIGN_UP_TITLE} subtitle="Loading your application…">
        <View style={styles.stack} accessible accessibilityRole="progressbar" accessibilityLabel="Loading your application">
          <SkeletonCard lines={2} />
          <SkeletonCard lines={3} />
        </View>
      </PartnerScreen>
    );
  }

  const ready = bootPhase === "ready";
  const backStep = STEP_BACK[step];
  const position = ready ? stepPosition(step) : null;
  const onInviteScreens = ready && (step === "welcome" || step === "account");

  const notices = (
    <>
      {ready && changesNotes && step !== "done" ? <Banner tone="warning" title="HOMEEIGO asked for changes" message={changesNotes} testID="onboarding-changes-requested" /> : null}
      {inviteWarning && onInviteScreens ? (
        inviteWarning.retry ? (
          <Banner
            tone="warning"
            title="Invite could not be checked"
            message={inviteWarning.message}
            action={
              <Button
                label="Try again"
                variant="secondary"
                onPress={() => {
                  setInviteWarning(null);
                  setBootPhase("loading");
                  setBootKey((k) => k + 1);
                }}
              />
            }
          />
        ) : (
          <Banner tone="warning" title="Invite could not be used" message={inviteWarning.message} />
        )
      ) : null}
      {invite && onInviteScreens ? (
        <Banner
          tone="info"
          title={`HOMEEIGO invited ${invite.name}`}
          message={`${[invite.skillInterest, invite.city].filter(Boolean).join(" · ") || "Complete your partner application"}. ${
            invite.phoneLast4 ? `Use the mobile ending in ${invite.phoneLast4}.` : "Use the same mobile number HOMEEIGO has on file."
          }`}
        />
      ) : null}
    </>
  );

  const frame: OnboardingFrameValue = {
    indicator: ready ? stepIndicatorText(step) : null,
    fraction: position ? position.number / position.total : null,
    savedLine: ready && restored ? formatLastSaved(lastSavedAt) : null,
    notices,
    error: error ?? (Object.keys(fieldErrors).length ? FIELDS_NEED_FIXING : null),
    onBack:
      bootPhase === "resume-sign-in"
        ? () => {
            setError(null);
            setBootPhase("ready");
          }
        : returnToReview
          ? () => {
              setReturnToReview(false);
              goTo("review");
            }
          : backStep
            ? () => goTo(backStep)
            : null,
    busy: loading,
  };
  // While a step is being sent, back waits: leaving mid-request is how an application gets lost.
  hardwareBack.current = frame.onBack ? (loading ? () => undefined : frame.onBack) : null;

  const signInLink = <Button label="Already a partner? Sign in" variant="quiet" onPress={goToSignIn} />;

  function content() {
    if (bootPhase === "resume-sign-in") {
      return (
        <OnboardingFrame
          key="resume"
          heading="Continue your application"
          lead="Sign in with the email and password from your application."
          primary={<Button label="Continue application" onPress={() => void handleResumeSignIn()} loading={loading} />}
        >
          <Card style={styles.stack}>
            <Field
              label="Email"
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="email"
              textContentType="emailAddress"
              returnKeyType="next"
            />
            <Field
              label="Password"
              value={resumePassword}
              onChangeText={setResumePassword}
              secure
              maxLength={ONBOARDING_LIMITS.password}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={() => void handleResumeSignIn()}
            />
          </Card>
          {signInLink}
        </OnboardingFrame>
      );
    }

    switch (step) {
      case "welcome":
        return (
          <OnboardingFrame
            key="welcome"
            subtitle="Each step is saved when you continue."
            heading="Your application"
            lead="It takes ten short steps. Once your account is created you can stop after any step and continue later with your email and password."
            primary={<Button label={invite ? "Continue invite" : "Start application"} onPress={() => goTo("account")} />}
            secondary={<Button label="Continue existing application" variant="secondary" onPress={() => setBootPhase("resume-sign-in")} />}
          >
            {signInLink}
          </OnboardingFrame>
        );

      case "account":
        if (restored) {
          return (
            <OnboardingFrame
              key="account-verified"
              heading="Account verified"
              lead="Your account and mobile number are already verified. Continue with the rest of your application."
              primary={<Button label="Continue" onPress={() => goTo("services")} />}
            >
              {signInLink}
            </OnboardingFrame>
          );
        }
        return (
          <AccountStep
            form={form}
            email={email}
            errors={fieldErrors}
            loading={loading}
            after={signInLink}
            onEmailChange={setEmail}
            onChange={(patch) => setForm((prev) => ({ ...prev, ...patch }))}
            onSubmit={() => {
              const next = validateAccount(form, email);
              setFieldErrors(next);
              if (Object.keys(next).length) return;
              // Back from the OTP step and forward again: the account exists and its OTP is still
              // owed. Asking the server to create it twice is refused and leaves no way on.
              if (accountAwaitsOtp(createdAccount, email, form.phoneNumber)) {
                setError(null);
                goTo("otp");
                return;
              }
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
                setCreatedAccount({ email, phoneNumber: form.phoneNumber });
                goTo("otp");
              });
            }}
          />
        );

      case "otp": {
        const verify = () =>
          void run(async () => {
            await partnerRegistrationApi.verifyOtp({
              email,
              otp,
              userId,
              inviteToken: (await getApplicationInvite()) ?? undefined,
              referralCode: (await getPendingReferralCode()) ?? undefined,
            });
            goTo("services");
          });
        return (
          <OnboardingFrame
            key="otp"
            heading="Verify mobile"
            lead={form.phoneNumber ? `Enter the 6-digit OTP sent to +91${form.phoneNumber}.` : "Enter the 6-digit OTP sent to your mobile."}
            primary={<TextNamedPrimaryButton label="Verify OTP" onPress={verify} loading={loading} disabled={otp.length < ONBOARDING_LIMITS.otp} />}
          >
            <Card style={styles.stack}>
              <Field
                label="OTP"
                value={otp}
                onChangeText={(v) => setOtp(digitsOnly(v, ONBOARDING_LIMITS.otp))}
                help="6 digits."
                keyboardType="number-pad"
                maxLength={ONBOARDING_LIMITS.otp}
                autoComplete="one-time-code"
                textContentType="oneTimeCode"
                returnKeyType="done"
              />
              {devOtp ? (
                <T kind="caption" numeric>
                  Dev OTP: {devOtp}
                </T>
              ) : null}
            </Card>
          </OnboardingFrame>
        );
      }

      case "services":
        return (
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
        );

      case "profile":
        return (
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
                afterSave("location");
              });
            }}
          />
        );

      case "location":
        return (
          <LocationStep
            city={form.city}
            serviceRegions={form.serviceRegions}
            serviceRadiusKm={form.serviceRadiusKm}
            latitude={form.latitude}
            longitude={form.longitude}
            // The server's refusal too, not only this screen's own check: the step drops a point the
            // server said is outside the service area.
            error={stepError ?? error ?? undefined}
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
                const radiusKm = Number(form.serviceRadiusKm);
                const lat = Number(form.latitude);
                const lng = Number(form.longitude);
                const hasCoords =
                  Boolean(form.latitude?.trim()) &&
                  Boolean(form.longitude?.trim()) &&
                  Number.isFinite(lat) &&
                  Number.isFinite(lng);
                await partnerRegistrationApi.saveLocation({
                  city: form.city.trim(),
                  serviceRegions: regions.length ? regions : [form.city.trim()],
                  serviceRadiusKm: radiusKm,
                  ...(hasCoords ? { baseLatitude: lat, baseLongitude: lng } : {}),
                });
                afterSave("availability");
              });
            }}
          />
        );

      case "availability":
        return (
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
                afterSave("kyc");
              });
            }}
          />
        );

      case "kyc":
        return (
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
                afterSave("documents");
              });
            }}
          />
        );

      case "documents":
        return (
          <DocumentsStep
            loading={loading}
            onContinue={(uploaded) =>
              void run(async () => {
                await partnerRegistrationApi.completeDocuments(uploaded);
                afterSave("assessment");
              })
            }
          />
        );

      case "assessment":
        return (
          <AssessmentStep
            loading={loading}
            onPassed={() => {
              afterSave("training");
            }}
          />
        );

      case "training":
        return (
          <TrainingStep
            loading={loading}
            onContinue={() =>
              run(async () => {
                await partnerRegistrationApi.acknowledgeTraining();
                goTo("review");
              })
            }
          />
        );

      case "review":
        return (
          <ReviewStep
            loading={loading}
            onEdit={(target) => {
              setReturnToReview(true);
              goTo(target);
            }}
            onSubmit={() =>
              run(async () => {
                await partnerRegistrationApi.acknowledgeReview();
                await partnerRegistrationApi.submit();
                await clearApplicationInvite();
                goTo("done");
              })
            }
          />
        );

      case "done":
        return (
          <OnboardingFrame key="done" primary={<Button label="Back to sign in" onPress={goToSignIn} />}>
            <Card style={styles.done}>
              <View style={styles.doneIcon}>
                <CheckCircle2 color={color.success} size={28} />
              </View>
              <T testID="onboarding-submitted" kind="title" accessibilityRole="header" style={styles.center}>
                Application submitted
              </T>
              <T kind="body" tone="slate" style={styles.center}>
                It is now waiting for HOMEEIGO to review and approve it.
              </T>
            </Card>
          </OnboardingFrame>
        );
    }
  }

  return <OnboardingFrameProvider value={frame}>{content()}</OnboardingFrameProvider>;
}

const styles = StyleSheet.create({
  stack: { gap: space.lg },
  done: { alignItems: "center", gap: space.sm, paddingVertical: space.xxl },
  doneIcon: { width: 56, height: 56, borderRadius: radius.pill, backgroundColor: color.successWash, alignItems: "center", justifyContent: "center", marginBottom: space.sm },
  center: { textAlign: "center" },
});
