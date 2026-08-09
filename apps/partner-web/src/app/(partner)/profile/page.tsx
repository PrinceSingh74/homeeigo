"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, LogOut } from "lucide-react";
import { ProfileSections } from "@/components/profile/ProfileSections";
import { PartnerButton } from "@/components/ui/PartnerButton";
import { usePartnerStore } from "@/stores/partner-store";

export default function ProfilePage() {
  const logout = usePartnerStore((s) => s.logout);
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function handleSignOut() {
    setBusy(true);
    try {
      await logout();
    } finally {
      router.replace("/login");
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Profile</h1>
        <p className="text-sm text-partner-muted">Verification & account</p>
      </div>
      <ProfileSections />
      <PartnerButton
        variant="outline"
        className="w-full"
        disabled={busy}
        onClick={() => void handleSignOut()}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogOut className="h-4 w-4" />}
        {busy ? "Signing out…" : "Sign out"}
      </PartnerButton>
    </div>
  );
}
