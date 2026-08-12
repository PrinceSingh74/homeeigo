import { Suspense } from "react";
import { AuthFormFallback } from "@/components/auth/AuthFormFallback";
import { AppleOAuthCallback } from "@/components/auth/AppleOAuthCallback";

export default function AppleOAuthCallbackPage() {
  return (
    <Suspense fallback={<AuthFormFallback />}>
      <AppleOAuthCallback />
    </Suspense>
  );
}
