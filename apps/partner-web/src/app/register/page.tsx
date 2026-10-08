"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { GlassOnboardingShell, GlassStepper } from "@/components/onboarding/GlassOnboardingShell";
import { OnboardingResumeBanner } from "@/components/onboarding/OnboardingResumeBanner";
import { ChangesRequestedBanner } from "@/components/onboarding/ChangesRequestedBanner";
import { ResumeApplicationCard } from "@/components/onboarding/ResumeApplicationCard";
import { Step1Basic, type Step1AccountData } from "@/components/registration/Step1Basic";
import { Step2Services, type Step2Data } from "@/components/registration/Step2Services";
import { StepProfile } from "@/components/registration/StepProfile";
import { StepLocation } from "@/components/registration/StepLocation";
import { StepAvailability } from "@/components/registration/StepAvailability";
import { Step3KYC, type Step3Data } from "@/components/registration/Step3KYC";
import { Step4Documents } from "@/components/registration/Step4Documents";
import { StepAssessment } from "@/components/registration/StepAssessment";
import { StepTraining } from "@/components/registration/StepTraining";
import { StepReview } from "@/components/registration/StepReview";
import { getErrorMessage } from "@/lib/api-error";
import {
  WEB_ONBOARDING_FLOW,
  draftSection,
  mapCompletedToWebSteps,
  resolveWebOnboardingStep,
  type WebOnboardingStep,
} from "@/lib/onboarding-resume";
import {
  clearApplicationInvite,
  clearRegistrationToken,
  getApplicationInvite,
  getPendingReferralCode,
  getRegistrationToken,
  setApplicationInvite,
  setPendingReferralCode,
} from "@/lib/registration-session";
import { partnerRegistrationApi } from "@/services/partner-registration-api";

type BootPhase = "loading" | "ready" | "resume-sign-in";

export default function PartnerRegisterPage() {
  const router = useRouter();
  const [bootPhase, setBootPhase] = useState<BootPhase>("loading");
  const [step, setStep] = useState<WebOnboardingStep>("account");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [completed, setCompleted] = useState<string[]>([]);
  const [percentComplete, setPercentComplete] = useState(0);
  const [resumeLabel, setResumeLabel] = useState("Account");
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null);
  const [restored, setRestored] = useState(false);
  const [changesRequested, setChangesRequested] = useState(false);
  const [changesNotes, setChangesNotes] = useState<string | null>(null);
  const [changesStep, setChangesStep] = useState<string | null>(null);
  const [draftData, setDraftData] = useState<Record<string, unknown>>({});
  const [invite, setInvite] = useState<{
    firstName?: string;
    lastName?: string;
    name: string;
    skillInterest?: string | null;
    city?: string | null;
    phoneLast4?: string;
  } | null>(null);
  const [inviteWarning, setInviteWarning] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [devOtpHint, setDevOtpHint] = useState<string | null>(null);
  const [returnToReview, setReturnToReview] = useState(false);

  const applyProgress = useCallback(
    (progress: {
      completedSteps: string[];
      percentComplete: number;
      providerId?: string | null;
      draftData?: Record<string, unknown>;
      lastSavedAt?: string | null;
      resumeLabel?: string;
      submitted?: boolean;
      canResume?: boolean;
      changesRequested?: boolean;
      changesRequestedStep?: string | null;
      changesRequestedNotes?: string | null;
    }) => {
      const isChangesRequested = Boolean(progress.changesRequested);
      if (progress.submitted && !isChangesRequested) {
        setBootPhase("ready");
        setStep("submit");
        setCompleted(WEB_ONBOARDING_FLOW.map((s) => s.id));
        setPercentComplete(100);
        setResumeLabel("Review");
        setChangesRequested(false);
        return;
      }
      if (progress.canResume === false && !isChangesRequested) {
        setBootPhase("resume-sign-in");
        return;
      }
      const webCompleted = mapCompletedToWebSteps(progress.completedSteps);
      const nextStep = resolveWebOnboardingStep(
        progress.completedSteps,
        progress.submitted,
        progress.changesRequestedStep,
      );
      setCompleted(webCompleted);
      setStep(nextStep);
      setPercentComplete(progress.percentComplete);
      setResumeLabel(progress.resumeLabel ?? nextStep);
      setLastSavedAt(progress.lastSavedAt ?? null);
      setDraftData(progress.draftData ?? {});
      setChangesRequested(isChangesRequested);
      setChangesNotes(progress.changesRequestedNotes ?? null);
      setChangesStep(progress.changesRequestedStep ?? null);
      if (progress.providerId) setProviderId(progress.providerId);
      setRestored(true);
      setBootPhase("ready");
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const inviteToken = params.get("invite") || getApplicationInvite();
      const refCode = params.get("ref") || getPendingReferralCode();
      if (refCode) setPendingReferralCode(refCode);
      if (inviteToken) {
        setApplicationInvite(inviteToken);
        try {
          const preview = await partnerRegistrationApi.getInvite(inviteToken);
          if (!cancelled) {
            setInvite(preview);
            setInviteWarning(null);
          }
        } catch (err) {
          if (!cancelled) {
            setInvite(null);
            const message = getErrorMessage(err);
            setInviteWarning(
              /reach backend|network|failed to fetch/i.test(message)
                ? "Could not verify this invite. Check your connection and retry."
                : "This invite is invalid or expired. You can still apply with your own details.",
            );
          }
        }
      }
      const token = getRegistrationToken();
      if (!token) {
        if (!cancelled) setBootPhase("ready");
        return;
      }
      try {
        const progress = await partnerRegistrationApi.getProgress();
        if (!cancelled) applyProgress(progress);
      } catch {
        if (!cancelled) setBootPhase("resume-sign-in");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyProgress]);

  const stepIndex = WEB_ONBOARDING_FLOW.findIndex((s) => s.id === step);
  const displayPercent = Math.max(percentComplete, Math.round(((stepIndex + 1) / WEB_ONBOARDING_FLOW.length) * 100));

  const profileDraft = useMemo(() => draftSection(draftData, "profile"), [draftData]);
  const locationDraft = useMemo(() => draftSection(draftData, "location"), [draftData]);
  const availabilityDraft = useMemo(() => draftSection(draftData, "availability"), [draftData]);
  const servicesDraft = useMemo(() => draftSection<Step2Data>(draftData, "services"), [draftData]);
  const skillsDraft = useMemo(() => draftSection(draftData, "skills"), [draftData]);
  const kycDraft = useMemo(() => draftSection<Step3Data>(draftData, "kyc"), [draftData]);

  function markDone(id: string, next: WebOnboardingStep) {
    setCompleted((prev) => Array.from(new Set([...prev, id])));
    if (returnToReview) {
      setReturnToReview(false);
      setStep("review");
      return;
    }
    setStep(next);
  }

  async function handleRegister(data: Step1AccountData) {
    setLoading(true);
    setError(null);
    try {
      const result = await partnerRegistrationApi.step1({
        email: data.email,
        phoneNumber: data.phoneNumber,
        firstName: data.firstName,
        lastName: data.lastName,
        password: data.password,
        confirmPassword: data.confirmPassword,
      });
      setUserId(result.userId);
      setEmail(data.email);
      setOtpSent(true);
      if (result.devOtp) setDevOtpHint(result.devOtp);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleVerifyOtp(otp: string) {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      await partnerRegistrationApi.verifyOtp({
        email,
        otp,
        userId,
        inviteToken: getApplicationInvite() ?? undefined,
        referralCode: getPendingReferralCode() ?? undefined,
      });
      markDone("account", "services");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleServices(data: Step2Data) {
    setLoading(true);
    setError(null);
    try {
      const result = await partnerRegistrationApi.saveServices(data);
      setProviderId(result.providerId);
      await partnerRegistrationApi.saveSkills({
        primarySkill: data.serviceCategories[0] ?? "General",
        secondarySkills: data.serviceCategories.slice(1),
        experienceYears: data.experienceYears,
      });
      markDone("services", "profile");
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleResumeSignIn(resumeEmail: string, password: string) {
    setLoading(true);
    setError(null);
    try {
      const progress = await partnerRegistrationApi.resumeApplication({
        email: resumeEmail,
        password,
      });
      setEmail(progress.email);
      setUserId(progress.userId);
      // The account was created but its phone was never verified: the server has sent a new OTP.
      if (progress.nextStep === "verify-otp") {
        setOtpSent(true);
        if (progress.devOtp) setDevOtpHint(progress.devOtp);
        setStep("account");
        setBootPhase("ready");
        return;
      }
      applyProgress({ ...progress, completedSteps: progress.completedSteps ?? [], percentComplete: progress.percentComplete ?? 0 });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  if (bootPhase === "loading") {
    return (
      <div className="min-h-screen bg-gradient-to-b from-[#fafbff] via-[#fcf9f0] to-white px-4 py-16">
        <div className="mx-auto max-w-lg space-y-4">
          <div className="h-8 w-48 animate-pulse rounded-lg bg-partner-line/60" />
          <div className="h-40 animate-pulse rounded-2xl bg-partner-line/40" />
          <div className="h-72 animate-pulse rounded-2xl bg-partner-line/40" />
        </div>
      </div>
    );
  }

  return (
    <GlassOnboardingShell
      title="Become a HOMEEIGO Partner"
      subtitle="Complete your application — progress is saved automatically."
      percentComplete={displayPercent}
      progress={<GlassStepper steps={[...WEB_ONBOARDING_FLOW]} current={step} completed={completed} />}
    >
      {bootPhase === "resume-sign-in" ? (
        <>
          <p role="alert" className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
            Your application session expired or could not be restored. Sign in with the email and password
            from your application to continue.
          </p>
          <ResumeApplicationCard
            mode="sign-in"
            percentComplete={0}
            resumeLabel="your application"
            loading={loading}
            onSubmitCredentials={handleResumeSignIn}
          />
        </>
      ) : null}

      {restored && changesRequested ? (
        <ChangesRequestedBanner
          stepLabel={resumeLabel}
          notes={changesNotes}
          onContinue={() =>
            setStep(resolveWebOnboardingStep(completed, false, changesStep))
          }
        />
      ) : null}

      {restored && !changesRequested ? (
        <OnboardingResumeBanner
          percentComplete={displayPercent}
          resumeLabel={resumeLabel}
          lastSavedAt={lastSavedAt}
        />
      ) : null}

      {inviteWarning && step === "account" && bootPhase === "ready" && !restored ? (
        <div role="alert" className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
          {inviteWarning}
        </div>
      ) : null}

      {!invite && getPendingReferralCode() && step === "account" && bootPhase === "ready" && !restored ? (
        <div className="mb-6 overflow-hidden rounded-2xl border border-partner-primary/20 bg-gradient-to-br from-partner-primary/10 to-white px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-partner-primary">Partner referral</p>
          <p className="mt-1 text-base font-semibold">You were invited with a partner referral code</p>
          <p className="mt-1 text-sm text-partner-muted">Your application will be attributed after mobile verification.</p>
        </div>
      ) : null}

      {invite && step === "account" && bootPhase === "ready" && !restored ? (
        <div className="mb-6 overflow-hidden rounded-2xl border border-partner-primary/20 bg-gradient-to-br from-partner-primary/10 to-white px-4 py-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-partner-primary">
            Personal invite
          </p>
          <p className="mt-1 text-base font-semibold">HOMEEIGO invited {invite.name}</p>
          <p className="mt-1 text-sm text-partner-muted">
            {[invite.skillInterest, invite.city].filter(Boolean).join(" · ") || "Complete your partner application."}
            {invite.phoneLast4
              ? ` Use the mobile ending in ${invite.phoneLast4}.`
              : " Use the same mobile number HQ has on file."}
          </p>
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="mb-4 rounded-xl border border-partner-danger/30 bg-red-50 px-4 py-3 text-sm text-partner-danger">
          {error}
        </div>
      ) : null}

      {step === "account" && bootPhase === "ready" && !restored ? (
        <>
          <Step1Basic
            otpSent={otpSent}
            devOtpHint={devOtpHint}
            loading={loading}
            initialValues={{
              firstName: invite?.firstName,
              lastName: invite?.lastName,
              email,
            }}
            onRegister={handleRegister}
            onVerifyOtp={handleVerifyOtp}
          />
          <ResumeApplicationCard
            compact
            mode="sign-in"
            percentComplete={0}
            resumeLabel="your application"
            loading={loading}
            onSubmitCredentials={handleResumeSignIn}
          />
        </>
      ) : null}

      {step === "account" && restored ? (
        <div className="rounded-xl border border-partner-line bg-white/60 px-4 py-6 text-center">
          <p className="font-medium">Account verified</p>
          <p className="mt-1 text-sm text-partner-muted">Continue with the next steps of your application.</p>
          <button
            type="button"
            onClick={() => setStep(resolveWebOnboardingStep(completed))}
            className="mt-4 rounded-xl bg-partner-primary px-4 py-2.5 text-sm font-semibold text-white"
          >
            Continue from {resumeLabel}
          </button>
        </div>
      ) : null}

      {step === "services" ? (
        <Step2Services
          onSubmit={handleServices}
          loading={loading}
          initialValues={{
            serviceCategories:
              servicesDraft.serviceCategories ??
              (skillsDraft.primarySkill ? [String(skillsDraft.primarySkill)] : undefined),
            city: servicesDraft.city ? String(servicesDraft.city) : undefined,
            experienceYears:
              servicesDraft.experienceYears ?? (skillsDraft.experienceYears as number | undefined),
          }}
        />
      ) : null}

      {step === "profile" ? (
        <StepProfile
          loading={loading}
          initialValues={{
            dateOfBirth: profileDraft.dateOfBirth ? String(profileDraft.dateOfBirth) : undefined,
            gender: profileDraft.gender ? String(profileDraft.gender) : undefined,
            emergencyContactName: profileDraft.emergencyContactName
              ? String(profileDraft.emergencyContactName)
              : undefined,
            emergencyContactPhone: profileDraft.emergencyContactPhone
              ? String(profileDraft.emergencyContactPhone)
              : undefined,
          }}
          onSubmit={async (data) => {
            setLoading(true);
            setError(null);
            try {
              await partnerRegistrationApi.saveProfile(data);
              markDone("profile", "location");
            } catch (err) {
              setError(getErrorMessage(err));
            } finally {
              setLoading(false);
            }
          }}
        />
      ) : null}

      {step === "location" ? (
        <StepLocation
          loading={loading}
          initialValues={{
            city: locationDraft.city ? String(locationDraft.city) : "",
            serviceRegions: Array.isArray(locationDraft.serviceRegions)
              ? (locationDraft.serviceRegions as string[])
              : [],
            serviceRadiusKm:
              typeof locationDraft.serviceRadiusKm === "number" ? locationDraft.serviceRadiusKm : 5,
            baseLatitude: locationDraft.baseLatitude as number | undefined,
            baseLongitude: locationDraft.baseLongitude as number | undefined,
          }}
          onSubmit={async (data) => {
            setLoading(true);
            setError(null);
            try {
              await partnerRegistrationApi.saveLocation(data);
              markDone("location", "availability");
            } catch (err) {
              setError(getErrorMessage(err));
            } finally {
              setLoading(false);
            }
          }}
        />
      ) : null}

      {step === "availability" ? (
        <StepAvailability
          loading={loading}
          initialValues={{
            workingHoursStart: availabilityDraft.workingHoursStart
              ? String(availabilityDraft.workingHoursStart)
              : undefined,
            workingHoursEnd: availabilityDraft.workingHoursEnd
              ? String(availabilityDraft.workingHoursEnd)
              : undefined,
            workingDays: availabilityDraft.workingDays as string[] | undefined,
          }}
          onSubmit={async (data) => {
            setLoading(true);
            setError(null);
            try {
              await partnerRegistrationApi.saveAvailability(data);
              markDone("availability", "kyc");
            } catch (err) {
              setError(getErrorMessage(err));
            } finally {
              setLoading(false);
            }
          }}
        />
      ) : null}

      {step === "kyc" ? (
        <Step3KYC
          loading={loading}
          initialValues={kycDraft}
          onSubmit={async (data: Step3Data) => {
            setLoading(true);
            setError(null);
            try {
              await partnerRegistrationApi.saveKyc({
                panNumber: data.panNumber.trim().toUpperCase() || undefined,
                aadharNumber: data.aadharNumber.trim() || undefined,
                bankAccountNumber: data.bankAccountNumber.trim() || undefined,
                bankAccountHolder: data.bankAccountHolder.trim() || undefined,
                ifscCode: data.ifscCode.trim().toUpperCase() || undefined,
                bankName: data.bankName.trim() || undefined,
              });
              markDone("kyc", "documents");
            } catch (err) {
              setError(getErrorMessage(err));
            } finally {
              setLoading(false);
            }
          }}
        />
      ) : null}

      {step === "documents" ? (
        <Step4Documents
          loading={loading}
          onContinue={async (uploadedTypes) => {
            setLoading(true);
            setError(null);
            try {
              await partnerRegistrationApi.completeDocuments(uploadedTypes);
              markDone("documents", "assessment");
            } catch (err) {
              setError(getErrorMessage(err));
            } finally {
              setLoading(false);
            }
          }}
        />
      ) : null}

      {step === "assessment" ? (
        <StepAssessment
          loading={loading}
          onPassed={async () => {
            markDone("assessment", "training");
          }}
        />
      ) : null}

      {step === "training" ? (
        <StepTraining
          loading={loading}
          onContinue={async () => {
            setLoading(true);
            setError(null);
            try {
              await partnerRegistrationApi.acknowledgeTraining();
              markDone("training", "review");
            } catch (err) {
              setError(getErrorMessage(err));
            } finally {
              setLoading(false);
            }
          }}
        />
      ) : null}

      {step === "review" ? (
        <StepReview
          loading={loading}
          onEdit={(target) => {
            setReturnToReview(true);
            setStep(target);
          }}
          onSubmit={async () => {
            setLoading(true);
            setError(null);
            try {
              await partnerRegistrationApi.acknowledgeReview();
              const pid = providerId;
              await partnerRegistrationApi.submit();
              clearRegistrationToken();
              clearApplicationInvite();
              markDone("review", "submit");
              router.push(pid ? `/registration-success?providerId=${pid}` : "/registration-success");
            } catch (err) {
              setError(getErrorMessage(err));
            } finally {
              setLoading(false);
            }
          }}
        />
      ) : null}

      {step === "submit" ? (
        <div className="rounded-2xl border border-emerald-200 bg-gradient-to-br from-emerald-50 to-white px-5 py-8 text-center">
          <h1 className="text-lg font-semibold text-emerald-950">Application submitted</h1>
          <p className="mt-2 text-sm leading-6 text-emerald-800">
            HQ will review your documents, KYC, and assessment. Typical turnaround is 1–2 business days.
          </p>
          <Link
            href="/login"
            className="mt-5 inline-flex rounded-xl bg-partner-primary px-4 py-2.5 text-sm font-semibold text-white"
          >
            Back to sign in
          </Link>
        </div>
      ) : null}
    </GlassOnboardingShell>
  );
}
