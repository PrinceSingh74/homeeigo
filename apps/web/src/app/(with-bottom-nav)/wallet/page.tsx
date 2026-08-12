import type { Metadata } from "next";
import { WalletDashboard } from "@/components/wallet/WalletDashboard";

export const metadata: Metadata = {
  title: "Wallet",
  robots: { index: false, follow: false },
};

export default function WalletPage() {
  return <WalletDashboard />;
}
