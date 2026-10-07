import { StyleSheet, View } from "react-native";
import { Card, KeyValue, T } from "@/components/ui";
import { rupees } from "@/lib/money-format";
import { color, space } from "@/theme/tokens";
import type { PartnerPayoutsData } from "@/types/partner";

/**
 * "What am I owed": the balances `GET /api/providers/me/payouts` sends, each named for what it is.
 * Nothing here is added, subtracted or estimated on the phone.
 *
 * `nextPayoutDate` is deliberately not shown: the server fills it with the time the newest
 * in-progress withdrawal was requested (or processed), which is not a date money will arrive.
 */
export function BalanceHeader({ payouts }: { payouts: PartnerPayoutsData }) {
  return (
    <Card testID="wallet-balance">
      <View accessibilityLabel="Wallet balance summary">
        <T kind="small" tone="slate">
          Available to withdraw
        </T>
        <T kind="display" numeric testID="wallet-available" style={styles.amount}>
          {rupees(payouts.availableBalance)}
        </T>
        <View style={styles.lines}>
          <KeyValue label="Wallet balance" value={rupees(payouts.currentBalance)} testID="wallet-current" />
          <KeyValue label="Withdrawals in progress" value={rupees(payouts.pendingBalance)} testID="wallet-pending" />
          <KeyValue label="Net earned, all time" value={rupees(payouts.lifetimeEarnings)} />
          <KeyValue label="Gross earned, all time" value={rupees(payouts.lifetimeGross)} />
        </View>
        <T kind="small">Available is your wallet balance less the money held for withdrawals that are still in progress.</T>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  amount: { color: color.marigold, marginTop: space.xs },
  lines: { marginTop: space.md, marginBottom: space.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line, paddingTop: space.sm },
});
