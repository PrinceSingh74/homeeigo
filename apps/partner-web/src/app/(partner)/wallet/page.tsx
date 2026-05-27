import { WalletDashboard } from "@/components/wallet/WalletDashboard";

export default function WalletPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">Wallet & earnings</h1>
        <p className="text-sm text-partner-muted">
          Payouts, incentives, and balance
        </p>
      </div>
      <WalletDashboard />
    </div>
  );
}
