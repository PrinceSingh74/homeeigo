"use client";

import { ProfileSections } from "@/components/profile/ProfileSections";
import { PartnerButton } from "@/components/ui/PartnerButton";
import { usePartnerStore } from "@/stores/partner-store";
import { useRouter } from "next/navigation";

export default function ProfilePage() {
  const setAuthenticated = usePartnerStore((s) => s.setAuthenticated);
  const router = useRouter();

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
        onClick={() => {
          setAuthenticated(false);
          router.push("/login");
        }}
      >
        Sign out
      </PartnerButton>
    </div>
  );
}
