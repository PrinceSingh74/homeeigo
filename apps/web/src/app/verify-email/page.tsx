import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthFormFallback } from "@/components/auth/AuthFormFallback";
import { VerifyEmailForm } from "@/components/auth/VerifyEmailForm";

export const metadata: Metadata = {
  title: "Verify Email",
  robots: { index: false, follow: false },
};

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<AuthFormFallback />}>
      <VerifyEmailForm />
    </Suspense>
  );
}
