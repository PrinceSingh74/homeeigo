import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import { Crown, ReceiptText } from "lucide-react-native";
import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { AccountScreen, ErrorState, ListSkeleton, ResultBanner, RowsSkeleton, failure, type ActionResult } from "@/components/account/states";
import { Banner, Button, Card, EmptyState, KeyValue, ListRow, Pill, T, formatRupees } from "@/components/ui";
import { useAuthed, usePullRefresh } from "@/hooks/account/queries";
import { useRazorpayCheckout } from "@/hooks/use-razorpay-checkout";
import { formatDate } from "@/lib/format";
import { partnerApi } from "@/services/partner-api";
import { space } from "@/theme/tokens";

/** Four counts — that is all the server keeps for this screen; there are no rows behind them. */
export function ServiceHistoryScreen() {
  const enabled = useAuthed();
  const history = useQuery({ queryKey: ["partner", "service-history"], queryFn: () => partnerApi.partnerOs.serviceHistory(), enabled });
  const { refreshing, onRefresh } = usePullRefresh(history);
  const h = history.data;
  return (
    <AccountScreen title="Service history" refreshing={refreshing} onRefresh={onRefresh}>
      {history.isLoading ? (
        <RowsSkeleton label="Loading your service history" />
      ) : !h ? (
        <ErrorState error={history.error} title="Your service history could not be loaded" onRetry={() => void history.refetch()} />
      ) : (
        <>
          <Card testID="service-history">
            <KeyValue label="Jobs completed" value={String(h.completed)} strong />
            <KeyValue label="Jobs cancelled" value={String(h.cancelled)} />
            <KeyValue label="Jobs rescheduled" value={String(h.rescheduled)} />
            <KeyValue label="Jobs coming up" value={String(h.upcoming)} />
          </Card>
          <T kind="small">These are totals. To see the jobs themselves, open the Jobs tab and choose Completed or Closed.</T>
          <Button label="Open jobs" variant="secondary" onPress={() => router.push("/(tabs)/requests")} testID="service-history-open-jobs" />
        </>
      )}
    </AccountScreen>
  );
}

/** Earning invoices (one per paid job) and settlements. A row with a job opens the job. */
export function AccountInvoicesScreen() {
  const enabled = useAuthed();
  const invoices = useQuery({ queryKey: ["partner", "invoices"], queryFn: () => partnerApi.getInvoices(), enabled });
  const { refreshing, onRefresh } = usePullRefresh(invoices);
  const d = invoices.data;
  return (
    <AccountScreen title="Invoices" refreshing={refreshing} onRefresh={onRefresh}>
      {invoices.isLoading ? (
        <ListSkeleton cards={2} label="Loading your invoices" />
      ) : !d ? (
        <ErrorState error={invoices.error} title="Your invoices could not be loaded" onRetry={() => void invoices.refetch()} />
      ) : d.earnings.length === 0 && d.settlements.length === 0 ? (
        <EmptyState icon={ReceiptText} title="No invoices yet" message="An invoice appears here for each job you are paid for, and for each settlement." testID="invoices-empty" />
      ) : (
        <>
          <Card>
            <View style={styles.stack}>
              <T kind="heading" accessibilityRole="header">
                Earning invoices
              </T>
              {d.earnings.length === 0 ? (
                <T kind="small">No earning invoices yet.</T>
              ) : (
                d.earnings.map((row, i) => (
                  <ListRow key={row.id} testID={`invoice-${row.id}`} title={row.invoiceNumber} subtitle={`${row.service} · ${formatDate(row.date)}`} value={formatRupees(row.net)} last={i === d.earnings.length - 1} />
                ))
              )}
              <T kind="small">Amounts are after commission. An earning that was later reversed is still listed here; the job's own earning shows its current state.</T>
            </View>
          </Card>
          <Card>
            <View style={styles.stack}>
              <T kind="heading" accessibilityRole="header">
                Settlements
              </T>
              {d.settlements.length === 0 ? <T kind="small">No settlements yet.</T> : d.settlements.map((s, i) => <ListRow key={s.id} title={s.settlementNumber} subtitle={`${s.status.replace(/_/g, " ")} · ${formatDate(s.date)}`} value={formatRupees(s.netAmount)} last={i === d.settlements.length - 1} />)}
            </View>
          </Card>
        </>
      )}
    </AccountScreen>
  );
}

/**
 * Membership is the CUSTOMER membership programme of this login (`/api/subscriptions/*`); nothing
 * in it is partner-specific, and the screen says so. Plans, prices and benefits are the server's.
 */
export function AccountMembershipScreen() {
  const qc = useQueryClient();
  const enabled = useAuthed();
  const { openCheckout } = useRazorpayCheckout();
  const plans = useQuery({ queryKey: ["partner", "plans"], queryFn: () => partnerApi.subscriptions.plans(), enabled });
  const mine = useQuery({ queryKey: ["partner", "subscription"], queryFn: () => partnerApi.subscriptions.mine(), enabled });
  const entitlements = useQuery({ queryKey: ["partner", "entitlements"], queryFn: () => partnerApi.subscriptions.entitlements(), enabled });
  const { refreshing, onRefresh } = usePullRefresh(plans, mine, entitlements);
  const [result, setResult] = useState<ActionResult>(null);

  const upgrade = useMutation({
    mutationFn: async (planId: string) => {
      const order = await partnerApi.subscriptions.createOrder(planId);
      let outcome: "paid" | "dismissed" = "dismissed";
      let failureMessage: string | null = null;
      await openCheckout({
        key: order.key,
        orderId: order.razorpayOrderId,
        amount: order.amount,
        currency: order.currency,
        name: "HOMEEIGO Partner",
        description: order.planName,
        checkoutMode: order.checkoutMode,
        onSuccess: async (payload) => {
          await partnerApi.subscriptions.verify({ razorpayOrderId: payload.razorpay_order_id, razorpayPaymentId: payload.razorpay_payment_id, razorpaySignature: payload.razorpay_signature });
          outcome = "paid";
        },
        onFailure: (message) => {
          failureMessage = message;
        },
      });
      if (failureMessage) throw new Error(failureMessage);
      return { outcome: outcome as "paid" | "dismissed", planName: order.planName };
    },
    onMutate: () => setResult(null),
    onSuccess: async (data) => {
      if (data.outcome !== "paid") {
        setResult({ tone: "info", message: "Payment was not completed. You have not been charged for a plan." });
        return;
      }
      await Promise.all([qc.invalidateQueries({ queryKey: ["partner", "subscription"] }), qc.invalidateQueries({ queryKey: ["partner", "entitlements"] })]);
      setResult({ tone: "success", message: `${data.planName} is now active.` });
    },
    onError: (e) => setResult(failure(e, "The plan could not be bought.")),
  });

  const active = mine.data?.active ?? null;
  return (
    <AccountScreen title="Membership" refreshing={refreshing} onRefresh={onRefresh}>
      <Banner tone="info" message="This is the HOMEEIGO customer membership for your login. It gives benefits when you book services as a customer; it does not change your partner earnings." />
      <ResultBanner result={result} testID="membership-result" />
      {mine.isLoading ? (
        <RowsSkeleton rows={2} label="Loading your membership" />
      ) : !mine.data ? (
        <Card>
          <ErrorState error={mine.error} title="Your membership could not be loaded" onRetry={() => void mine.refetch()} />
        </Card>
      ) : active ? (
        <Card testID="membership-active">
          <KeyValue label="Your plan" value={active.plan.name} strong />
          <KeyValue label={active.autoRenew ? "Renews on" : "Ends on"} value={active.expiresAt ? formatDate(active.expiresAt) : "—"} />
        </Card>
      ) : (
        <Card>
          <T kind="body">You do not have a membership.</T>
        </Card>
      )}

      {plans.isLoading ? (
        <ListSkeleton cards={2} lines={2} label="Loading plans" />
      ) : !plans.data ? (
        <ErrorState error={plans.error} title="Plans could not be loaded" onRetry={() => void plans.refetch()} />
      ) : plans.data.length === 0 ? (
        <EmptyState icon={Crown} title="No plans on offer" message="When HOMEEIGO offers a membership plan it appears here." />
      ) : (
        plans.data.map((plan) => {
          const current = active?.plan.id === plan.id;
          return (
            <Card key={plan.id} testID={`membership-plan-${plan.id}`}>
              <View style={styles.stack}>
                <View style={styles.head}>
                  <T kind="heading" style={styles.flex}>
                    {plan.name}
                  </T>
                  {current ? <Pill label="Your plan" tone="success" /> : null}
                </View>
                <T kind="bodyStrong" numeric>
                  {formatRupees(plan.price)} · {plan.interval.toLowerCase()}
                </T>
                {plan.description ? <T kind="small">{plan.description}</T> : null}
                {plan.benefits.map((b) => (
                  <T key={b.id} kind="small" tone="ink">
                    • {b.label}
                  </T>
                ))}
                {current ? null : (
                  <Button label={`Buy ${plan.name}`} variant="secondary" onPress={() => upgrade.mutate(plan.id)} loading={upgrade.isPending && upgrade.variables === plan.id} disabled={upgrade.isPending} testID={`membership-buy-${plan.id}`} />
                )}
              </View>
            </Card>
          );
        })
      )}

      {entitlements.data && entitlements.data.benefits.length > 0 ? (
        <Card>
          <View style={styles.stack}>
            <T kind="heading" accessibilityRole="header">
              Your benefits
            </T>
            {entitlements.data.benefits.map((b) => (
              <T key={`${b.type}-${b.label}`} kind="body">
                • {b.label}
              </T>
            ))}
          </View>
        </Card>
      ) : null}
      {__DEV__ ? <T kind="caption">Development build only — test payments: UPI success@razorpay, or card 5555 5555 5555 4444.</T> : null}
    </AccountScreen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: space.sm },
  head: { flexDirection: "row", alignItems: "center", gap: space.md },
  flex: { flex: 1 },
});
