import { MembershipCenter } from "@/components/membership/MembershipCenter";

export default function MembershipPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Membership</h1>
        <p className="text-sm text-partner-muted">
          Partner plans, benefits, and commission tiers
        </p>
      </div>
      <MembershipCenter />
    </div>
  );
}
