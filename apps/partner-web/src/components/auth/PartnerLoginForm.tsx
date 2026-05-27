"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Phone, Shield, Upload, Sparkles } from "lucide-react";
import { PartnerButton } from "@/components/ui/PartnerButton";
import { PartnerCard } from "@/components/ui/PartnerCard";
import { usePartnerStore } from "@/stores/partner-store";

type Step = "phone" | "otp" | "kyc";

export function PartnerLoginForm() {
  const router = useRouter();
  const setAuthenticated = usePartnerStore((s) => s.setAuthenticated);
  const [step, setStep] = useState<Step>("phone");
  const [phone, setPhone] = useState("");

  function completeLogin() {
    setAuthenticated(true);
    router.replace("/");
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-md"
    >
      <div className="mb-8 text-center">
        <p className="font-display text-3xl font-bold tracking-tight">
          HOMIGO <span className="text-partner-primary">Pro</span>
        </p>
        <p className="mt-2 text-sm text-partner-muted">
          Tesla-grade ops for home service professionals
        </p>
      </div>

      <PartnerCard glass>
        {step === "phone" && (
          <>
            <label className="text-xs font-medium text-partner-muted">
              Mobile number
            </label>
            <div className="mt-2 flex gap-2">
              <span className="flex items-center rounded-xl border border-partner-line bg-partner-bg/60 px-3 text-sm">
                +91
              </span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="98765 43210"
                className="flex-1 rounded-xl border border-partner-line bg-partner-bg/60 px-3 py-2.5 text-sm outline-none focus:border-partner-primary"
              />
            </div>
            <PartnerButton
              className="mt-4 w-full"
              onClick={() => phone.length >= 8 && setStep("otp")}
            >
              <Phone className="h-4 w-4" />
              Send OTP
            </PartnerButton>
          </>
        )}

        {step === "otp" && (
          <>
            <p className="text-sm text-partner-muted">
              Enter 6-digit code sent to +91 {phone}
            </p>
            <div className="mt-3 flex justify-center gap-2">
              {Array.from({ length: 6 }).map((_, i) => (
                <input
                  key={i}
                  maxLength={1}
                  className="h-12 w-10 rounded-xl border border-partner-line bg-partner-bg/60 text-center text-lg font-mono outline-none focus:border-partner-primary"
                  onInput={(e) => {
                    const t = e.currentTarget;
                    if (t.value && t.nextElementSibling instanceof HTMLInputElement) {
                      t.nextElementSibling.focus();
                    }
                  }}
                />
              ))}
            </div>
            <PartnerButton className="mt-4 w-full" onClick={() => setStep("kyc")}>
              Verify & continue
            </PartnerButton>
          </>
        )}

        {step === "kyc" && (
          <>
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Shield className="h-4 w-4 text-partner-primary" />
              KYC & AI verification
            </p>
            <p className="mt-1 text-xs text-partner-muted">
              Upload ID and skill docs. AI verifies in under 2 minutes (demo).
            </p>
            <div className="mt-4 space-y-2">
              {["Aadhaar (front)", "PAN card", "Skill certificate"].map((doc) => (
                <button
                  key={doc}
                  type="button"
                  className="flex w-full items-center justify-between rounded-xl border border-dashed border-partner-line px-3 py-3 text-sm transition hover:border-partner-primary/50"
                >
                  <span>{doc}</span>
                  <Upload className="h-4 w-4 text-partner-muted" />
                </button>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2 rounded-xl bg-partner-primary/10 px-3 py-2 text-xs">
              <Sparkles className="h-4 w-4 text-partner-primary" />
              AI document scan ready
            </div>
            <PartnerButton className="mt-4 w-full" onClick={completeLogin}>
              Complete onboarding
            </PartnerButton>
          </>
        )}
      </PartnerCard>

      <p className="mt-6 text-center text-xs text-partner-muted">
        New partner?{" "}
        <button type="button" className="text-partner-primary hover:underline">
          Register
        </button>
      </p>
    </motion.div>
  );
}
