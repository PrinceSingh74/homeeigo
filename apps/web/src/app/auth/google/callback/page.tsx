import { Suspense } from "react";
import { AuthFormFallback } from "@/components/auth/AuthFormFallback";
import { GoogleOAuthCallback } from "@/components/auth/GoogleOAuthCallback";

export default function GoogleOAuthCallbackPage() {
  return (
    <Suspense fallback={<AuthFormFallback />}>
      <GoogleOAuthCallback />
    </Suspense>
  );
}
