import { IndianRupee } from "lucide-react-native";
import { StyleSheet, View } from "react-native";
import { PanelLoading } from "@/components/job/parts";
import { Banner, Button, Card, T } from "@/components/ui";
import { formatDate } from "@/lib/format";
import { earningAmountText, jobEarningsView } from "@/lib/job-earnings";
import { failureSentence, isOfflineError } from "@/lib/job-screen";
import { color, space } from "@/theme/tokens";
import type { PartnerJobEarning } from "@/types/partner";

/**
 * "Your earning for this job" — in the server's own lines (gross, commission, a bonus or an
 * adjustment, net), with how it was settled and its invoice number. Asked for only once the job is
 * completed; before that the one sentence that says so. Nothing is estimated from the booking amount
 * and no rate is applied on the phone: a line the server did not send is not shown.
 */
export function JobEarnings({
  status,
  query,
}: {
  status: string;
  query: { data: PartnerJobEarning | null | undefined; isLoading: boolean; isError: boolean; error: unknown; isFetching: boolean; refetch: () => unknown };
}) {
  const view = jobEarningsView(status, query);
  if (view.state === "hidden") return null;
  return (
    <Card testID="job-earnings">
      <View style={styles.head}>
        <IndianRupee color={color.marigold} size={20} />
        <T kind="heading" accessibilityRole="header" style={styles.flex}>
          Your earning for this job
        </T>
      </View>
      {view.state === "loading" ? (
        <PanelLoading label="Loading your earning" lines={3} />
      ) : view.state === "lines" ? (
        <View>
          {view.lines.map((line) => {
            const total = line.kind === "total";
            const amount = earningAmountText(line);
            return (
              <View key={line.key} style={[styles.line, total ? styles.total : null]} accessible accessibilityLabel={`${line.label}: ${amount}`}>
                <T kind={total ? "bodyStrong" : "body"} tone={total ? "ink" : "slate"} style={styles.flex}>
                  {line.label}
                </T>
                <T kind={total ? "heading" : "body"} numeric testID={`job-earnings-${line.key}`} style={styles.amount}>
                  {amount}
                </T>
              </View>
            );
          })}
          <T kind="small" numeric style={styles.foot} testID="job-earnings-settlement">
            {`${view.settlementLabel} · ${formatDate(view.earnedAt)} · Invoice ${view.invoiceNumber}`}
          </T>
        </View>
      ) : view.state === "error" ? (
        <Banner
          tone="danger"
          testID="job-earnings-error"
          message={isOfflineError(query.error) ? failureSentence(query.error) : view.message}
          action={<Button label="Try again" variant="secondary" onPress={() => void query.refetch()} loading={query.isFetching} />}
        />
      ) : (
        <View style={styles.none}>
          <T kind="body" tone="slate" testID="job-earnings-message">
            {view.message}
          </T>
          {/* The row is written after completion: let the partner ask again instead of waiting out a cache. */}
          {view.state === "none" ? <Button label="Check again" variant="secondary" onPress={() => void query.refetch()} loading={query.isFetching} testID="job-earnings-recheck" /> : null}
        </View>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  head: { flexDirection: "row", alignItems: "center", gap: space.sm, marginBottom: space.md },
  line: { flexDirection: "row", alignItems: "baseline", gap: space.lg, paddingVertical: space.sm },
  total: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: color.line, marginTop: space.xs, paddingTop: space.md },
  amount: { textAlign: "right" },
  none: { gap: space.md },
  foot: { marginTop: space.sm },
});
