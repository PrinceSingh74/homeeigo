import { router } from "expo-router";
import { WalletScreen } from "@/screens/hq-work-earnings";
import { HqCard, HqLinkRow } from "@/components/HqUi";
import { PartnerScreen } from "@/components/PartnerScreen";
import { Award, Banknote, History, Wallet } from "lucide-react-native";

export default function WalletTab() {
  return (
    <PartnerScreen title="Wallet" subtitle="Balance, withdraw, transactions, and payout history.">
      <WalletScreen embedded />
      <HqCard>
        <HqLinkRow label="Incentives" subtitle="Bonus progress and paid rewards" icon={Award} onPress={() => router.push("/hq/earnings-incentives")} />
        <HqLinkRow label="Payouts" subtitle="Withdrawal history and settlement status" icon={Banknote} onPress={() => router.push("/hq/earnings-payouts")} />
        <HqLinkRow label="Full ledger" subtitle="Paginated transaction history" icon={History} onPress={() => router.push("/hq/wallet-ledger")} />
        <HqLinkRow label="Earnings HQ" subtitle="Overview, tax, and forecast" icon={Wallet} onPress={() => router.push("/hq/earnings-hq")} />
      </HqCard>
    </PartnerScreen>
  );
}
