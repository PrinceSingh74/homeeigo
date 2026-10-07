import { ArrowUpRight, Banknote } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { Banner, Button, Card, EmptyState, KeyValue, ListRow, Pill, Sheet, T } from "@/components/ui";
import { formatDayTime, humanise, rupees, withdrawalStatus } from "@/lib/money-format";
import { pageOf } from "@/lib/money-series";
import { color, space } from "@/theme/tokens";
import type { PartnerWithdrawal } from "@/types/partner";

/**
 * The partner's withdrawals as `GET /api/providers/me/withdrawals` lists them: the latest 20, with
 * the server's own status, and — in the detail — its dates, failure reason and payout attempts.
 * This is money out only; the server has no ledger of credits and debits to show.
 */
export function WithdrawalList({
  withdrawals,
  initiallyShown,
  onSeeAll,
}: {
  withdrawals: PartnerWithdrawal[];
  /** How many rows to show before "Show more"; omit to show every row sent. */
  initiallyShown?: number;
  /** When set, the "more" control leaves for the full list instead of expanding in place. */
  onSeeAll?: () => void;
}) {
  const [open, setOpen] = useState<PartnerWithdrawal | null>(null);
  const [expanded, setExpanded] = useState(false);
  const { visible, hidden } = pageOf(withdrawals, expanded || initiallyShown === undefined ? withdrawals.length : initiallyShown);

  if (withdrawals.length === 0) {
    return (
      <Card>
        <EmptyState icon={Banknote} title="No withdrawals yet" message="When you withdraw to your bank, each request appears here with its status." testID="withdrawals-empty" />
      </Card>
    );
  }

  return (
    <>
      <Card testID="withdrawals-list">
        {visible.map((w, i) => {
          const status = withdrawalStatus(w.status);
          return (
            <ListRow
              key={w.id}
              testID={`withdrawal-row-${i}`}
              icon={ArrowUpRight}
              tone={status.tone}
              title={w.withdrawalNumber}
              subtitle={`${status.label} · Requested ${formatDayTime(w.requestedAt)}`}
              value={rupees(w.amount)}
              onPress={() => setOpen(w)}
              last={i === visible.length - 1 && hidden === 0}
            />
          );
        })}
        {hidden > 0 ? (
          <Button
            label={onSeeAll ? "See all withdrawals" : `Show ${hidden} more`}
            variant="quiet"
            onPress={() => (onSeeAll ? onSeeAll() : setExpanded(true))}
            testID="withdrawals-more"
          />
        ) : null}
      </Card>
      <WithdrawalDetailSheet withdrawal={open} onClose={() => setOpen(null)} />
    </>
  );
}

function WithdrawalDetailSheet({ withdrawal: w, onClose }: { withdrawal: PartnerWithdrawal | null; onClose: () => void }) {
  if (!w) return null;
  const status = withdrawalStatus(w.status);
  const attempts = Array.isArray(w.payoutAttempts) ? w.payoutAttempts : [];
  return (
    <Sheet visible onClose={onClose} title="Withdrawal" testID="withdrawal-detail" footer={<Button label="Close" variant="secondary" onPress={onClose} />}>
      <View style={styles.head}>
        <T kind="bodyStrong" numeric>
          {w.withdrawalNumber}
        </T>
        <Pill label={status.label} tone={status.tone} testID="withdrawal-detail-status" />
      </View>

      {w.failureReason ? <Banner tone="danger" title="Why it failed" message={w.failureReason} testID="withdrawal-failure" /> : null}

      <View>
        <KeyValue label="Amount requested" value={rupees(w.amount)} />
        <KeyValue label="Processing fee" value={rupees(w.processingFee)} />
        <KeyValue label="Amount to your bank" value={rupees(w.netAmount)} strong />
      </View>

      <View style={styles.group}>
        <KeyValue label="Requested" value={formatDayTime(w.requestedAt)} />
        <KeyValue label="Processed" value={w.processedAt ? formatDayTime(w.processedAt) : "Not yet"} />
        <KeyValue label="Settled to your bank" value={w.completedAt ? formatDayTime(w.completedAt) : "Not yet"} />
        {w.razorpayStatus ? <KeyValue label="Bank transfer status" value={humanise(w.razorpayStatus)} /> : null}
        {w.razorpayPayoutId ? <KeyValue label="Payout reference" value={w.razorpayPayoutId} /> : null}
      </View>

      <View style={styles.group}>
        <T kind="smallStrong" tone="slate" accessibilityRole="header">
          Payout attempts
        </T>
        {attempts.length === 0 ? (
          <T kind="small">No payout attempt has been recorded for this withdrawal yet.</T>
        ) : (
          attempts.map((a) => (
            <View key={a.id} style={styles.attempt} accessible accessibilityLabel={`Attempt ${a.attemptNo}, ${humanise(a.status)}, ${formatDayTime(a.createdAt)}${a.failureReason ? `, ${a.failureReason}` : ""}`}>
              <View style={styles.attemptHead}>
                <T kind="bodyStrong">{`Attempt ${a.attemptNo}`}</T>
                <T kind="small" numeric>
                  {formatDayTime(a.createdAt)}
                </T>
              </View>
              <T kind="small" tone="ink">
                {humanise(a.status)}
              </T>
              {a.failureReason ? (
                <T kind="small" tone="danger">
                  {a.failureReason}
                </T>
              ) : null}
            </View>
          ))
        )}
        {attempts.length >= 5 ? <T kind="caption">Showing the latest 5 attempts.</T> : null}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: space.md, flexWrap: "wrap" },
  group: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line, paddingTop: space.md, gap: space.xs },
  attempt: { paddingVertical: space.sm, gap: 2 },
  attemptHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", gap: space.md },
});
