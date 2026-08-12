import { Loader2 } from "lucide-react";
import { AuroraBackground } from "@/components/AuroraBackground";

export function AuthFormFallback() {
  return (
    <div className="relative flex min-h-dvh items-center justify-center">
      <AuroraBackground />
      <Loader2 className="relative z-10 size-8 animate-spin text-primary" aria-label="Loading" />
    </div>
  );
}
