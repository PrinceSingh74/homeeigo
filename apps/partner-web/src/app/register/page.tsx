"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { RegistrationProgressBar } from "@/components/registration/ProgressBar";
import { Step1Basic, type Step1AccountData } from "@/components/registration/Step1Basic";
import { Step2Services, type Step2Data } from "@/components/registration/Step2Services";
import { Step3KYC, type Step3Data } from "@/components/registration/Step3KYC";
import { Step4Documents } from "@/components/registration/Step4Documents";
import { getErrorMessage } from "@/lib/api-error";
import { partnerRegistrationApi } from "@/services/partner-registration-api";

type Step = 1 | 2 | 3 | 4;

const STEPS = [
  { number: 1, label: "Account" },
  { number: 2, label: "Services" },
  { number: 3, label: "Details" },
  { number: 4, label: "Submit" },
];

export default function PartnerRegisterPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [userId, setUserId] = useState<string | null>(null);
  const [providerId, setProviderId] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [devOtpHint, setDevOtpHint] = useState<string | null>(null);

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
      if (result.devOtp) {
        setDevOtpHint(result.devOtp);
      }
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
      await partnerRegistrationApi.verifyOtp({ email, otp, userId });
      setStep(2);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleStep2(data: Step2Data) {
    if (!userId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await partnerRegistrationApi.saveServices(data);
      setProviderId(result.providerId);
      setStep(3);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleStep3(data: Step3Data) {
    if (!providerId) return;
    setLoading(true);
    setError(null);
    try {
      // These KYC fields are optional: send only the ones the user filled in
      // (undefined → omitted), because the backend rejects null for an optional
      // string. IFSC/PAN are normalised to uppercase to match the format rules.
      const clean = (v: string) => v.trim() || undefined;
      await partnerRegistrationApi.saveKyc({
        panNumber: data.panNumber.trim().toUpperCase() || undefined,
        aadharNumber: clean(data.aadharNumber),
        bankAccountNumber: clean(data.bankAccountNumber),
        bankAccountHolder: clean(data.bankAccountHolder),
        ifscCode: data.ifscCode.trim().toUpperCase() || undefined,
        bankName: clean(data.bankName),
      });
      setStep(4);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  async function handleStep4() {
    if (!providerId) return;
    setLoading(true);
    setError(null);
    try {
      await partnerRegistrationApi.submit();
      router.push(`/registration-success?providerId=${providerId}`);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="partner-mesh flex min-h-dvh items-center justify-center px-4 py-10">
      <div className="w-full max-w-xl">
        <div className="mb-8 text-center">
          <p className="text-xs font-semibold uppercase tracking-widest text-partner-primary">
            HOMEEIGO Pro
          </p>
          <h1 className="mt-2 text-3xl font-bold">Become a partner</h1>
          <p className="mt-1 text-sm text-[var(--color-partner-muted)]">
            Grow your home services business with HOMEEIGO
          </p>
        </div>

        <RegistrationProgressBar steps={STEPS} currentStep={step} />

        {error ? (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        ) : null}

        <PartnerCard className="p-6 sm:p-8">
          {step === 1 ? (
            <Step1Basic
              otpSent={otpSent}
              devOtpHint={devOtpHint}
              loading={loading}
              onRegister={handleRegister}
              onVerifyOtp={handleVerifyOtp}
            />
          ) : null}
          {step === 2 ? <Step2Services onSubmit={handleStep2} loading={loading} /> : null}
          {step === 3 ? <Step3KYC onSubmit={handleStep3} loading={loading} /> : null}
          {step === 4 && providerId ? (
            <Step4Documents onSubmit={handleStep4} loading={loading} />
          ) : null}
        </PartnerCard>

        {step > 1 ? (
          <button
            type="button"
            onClick={() => setStep((step - 1) as Step)}
            className="mt-4 w-full rounded-lg border border-[var(--color-partner-border)] py-3 text-sm font-medium text-[var(--color-partner-muted)] transition hover:bg-[var(--color-partner-elevated)]"
          >
            Back
          </button>
        ) : null}

        <p className="mt-6 text-center text-sm text-[var(--color-partner-muted)]">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-partner-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
