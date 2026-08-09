import { router } from "expo-router";
import { WalletScreen } from "@/screens/hq-work-earnings";
import { HqCard, HqLinkRow } from "@/components/HqUi";
import { PartnerScreen } from "@/components/PartnerScreen";
import { Wallet } from "lucide-react-native";

export default function WalletTab() {
  return (
    <PartnerScreen title="Wallet" subtitle="Balance, transactions, payouts, and ledger.">
      <WalletScreen embedded />
      <HqCard>
        <HqLinkRow label="Full ledger" subtitle="Paginated transaction history" icon={Wallet} onPress={() => router.push("/hq/wallet-ledger")} />
        <HqLinkRow label="Payouts" subtitle="Withdrawal history and next payout" icon={Wallet} onPress={() => router.push("/hq/earnings-payouts")} />
        <HqLinkRow label="Earnings HQ" subtitle="Overview, tax, forecast, incentives" icon={Wallet} onPress={() => router.push("/hq/earnings-hq")} />
      </HqCard>
    </PartnerScreen>
  );
}
