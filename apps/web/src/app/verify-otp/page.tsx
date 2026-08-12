import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthFormFallback } from "@/components/auth/AuthFormFallback";
import { VerifyOtpForm } from "@/components/auth/VerifyOtpForm";

export const metadata: Metadata = {
  title: "Verify OTP",
  robots: { index: false, follow: false },
};

export default function VerifyOtpPage() {
  return (
    <Suspense fallback={<AuthFormFallback />}>
      <VerifyOtpForm />
    </Suspense>
  );
}
