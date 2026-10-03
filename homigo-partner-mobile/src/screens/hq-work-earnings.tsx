import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Location from "expo-location";
import { useState } from "react";
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KpiCard } from "@/components/KpiCard";
import { WithdrawSheet } from "@/components/WithdrawSheet";
import {
  EmptyState,
  ErrorBlock,
  HqCard,
  HqCardTitle,
  HqMuted,
  LoadingBlock,
  ProgressRow,
  StatRow,
} from "@/components/HqUi";
import { PartnerScreen } from "@/components/PartnerScreen";
import {
  partnerPresenceHealthCopy,
  usePartnerPresenceHealth,
} from "@/hooks/use-partner-presence-heartbeat";
import { customerName, formatCurrency, formatDate, formatDateTime, formatPct, onlineHours } from "@/lib/format";
import { formatPayoutStatus } from "@/lib/finance";
import { BOOKING_LIST_FILTER } from "@/lib/booking-status";
import { BackgroundLocationNotice } from "@/components/BackgroundLocationNotice";
import { partnerApi } from "@/services/partner-api";
import { partnerColors } from "@/theme/colors";

export function useProviderQuery() {
  return useQuery({ queryKey: ["partner", "provider"], queryFn: () => partnerApi.provider() });
}

export function useDashboardQuery() {
  return useQuery({ queryKey: ["partner", "dashboard"], queryFn: () => partnerApi.dashboard() });
}

function HqShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <PartnerScreen title={title} subtitle={subtitle} showBack>
      {children}
    </PartnerScreen>
  );
}

export function OnlineToggleCard() {
  const qc = useQueryClient();
  const presence = usePartnerPresenceHealth();
  const provider = useProviderQuery();
  const operations = useQuery({ queryKey: ["partner", "operations"], queryFn: () => partnerApi.operations() });
  const toggle = useMutation({
    mutationFn: (online: boolean) => partnerApi.setOnline(online),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["partner", "provider"] });
      void qc.invalidateQueries({ queryKey: ["partner", "dashboard"] });
      void qc.invalidateQueries({ queryKey: ["partner", "operations"] });
    },
  });
  const ops = operations.data;
  const online = ops?.uiOnline ?? provider.data?.isOnline ?? false;
  const paused = ops?.isPaused ?? false;
  const suspended = ops?.isSuspended ?? false;
  const presenceLine = partnerPresenceHealthCopy({
    receiveJobs: online && !paused && !suspended,
    connected: presence.connected,
    reconnecting: presence.reconnecting,
    presenceFreshness: presence.presenceFreshness,
  });
  return (
    <HqCard>
      <HqCardTitle>{suspended ? "Account restricted" : paused ? "Paused" : online ? "Online" : "Offline"}</HqCardTitle>
      <HqMuted>
        {suspended
          ? ops?.suspendedMessage ?? "Your account is currently unavailable for job assignments."
          : paused
            ? "New offers are paused. Current jobs continue."
            : online
              ? `Available for jobs${ops ? ` · ${ops.capacity.currentJobs}/${ops.capacity.maxConcurrentJobs} capacity` : ""}`
              : "You're offline and won't receive new job offers."}
      </HqMuted>
      {presenceLine ? (
        presenceLine.tone === "ok" ? (
          <HqMuted>{presenceLine.text}</HqMuted>
        ) : (
          <Text style={styles.presenceWarn}>{presenceLine.text}</Text>
        )
      ) : null}
      {online && !suspended ? <BackgroundLocationNotice /> : null}
      {ops && !operations.isLoading ? (
        <StatRow label="Slots" value={String(ops.capacity.availableSlots)} />
      ) : null}
      {ops?.readiness.blockers.map((b) => (
        <HqMuted key={b.code}>{b.message}</HqMuted>
      ))}
      <Pressable
        onPress={() => toggle.mutate(!online)}
        disabled={toggle.isPending || suspended}
        style={[styles.toggleBtn, online ? styles.toggleOn : styles.toggleOff]}
      >
        <Text style={styles.toggleText}>{online ? "Go Offline" : "Go Online"}</Text>
      </Pressable>
    </HqCard>
  );
}

export function WorkHqScreen() {
  const dashboard = useDashboardQuery();
  const provider = useProviderQuery();
  if (dashboard.isLoading || provider.isLoading) return <HqShell title="Work HQ" subtitle="Live status"><LoadingBlock /></HqShell>;
  if (dashboard.isError) return <HqShell title="Work HQ" subtitle="Live status"><ErrorBlock message="Could not load work HQ data." /></HqShell>;
  const d = dashboard.data!;
  const hours = onlineHours(provider.data?.onlineSince ?? d.onlineSince).toFixed(1);
  return (
    <HqShell title="Work HQ" subtitle="Requests, bookings, attendance, and shift controls.">
      <View style={styles.grid}>
        <KpiCard label="Live requests" value={d.counts.pendingRequests} />
        <KpiCard label="Active jobs" value={d.counts.activeBookings} />
        <KpiCard label="Completed today" value={d.counts.completedToday} />
        <KpiCard label="Session hours" value={`${hours}h`} />
      </View>
      <OnlineToggleCard />
    </HqShell>
  );
}

export function WorkAttendanceScreen() {
  const qc = useQueryClient();
  const attendance = useQuery({ queryKey: ["partner", "attendance"], queryFn: () => partnerApi.partnerOs.attendance() });
  const checkIn = useMutation({
    mutationFn: () => partnerApi.partnerOs.checkIn(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["partner", "attendance"] }),
  });
  const checkOut = useMutation({
    mutationFn: () => partnerApi.partnerOs.checkOut(),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["partner", "attendance"] }),
  });
  if (attendance.isLoading) return <HqShell title="Attendance" subtitle="Check-in/out trends"><LoadingBlock /></HqShell>;
  const data = attendance.data;
  return (
    <HqShell title="Attendance Center" subtitle="Check-in/out trends and weekly/monthly attendance.">
      <View style={styles.grid}>
        <KpiCard label="Hours today" value={data?.workingHoursToday ?? 0} />
        <KpiCard label="Days this week" value={data?.weeklyAttendance ?? 0} />
        <KpiCard label="Days this month" value={data?.monthlyAttendance ?? 0} />
      </View>
      <HqCard>
        <HqCardTitle>Shift control</HqCardTitle>
        <StatRow label="Status" value={data?.isCheckedIn ? "Checked in" : "Off shift"} />
        <Pressable disabled={data?.isCheckedIn || checkIn.isPending} onPress={() => checkIn.mutate()} style={[styles.primaryBtn, data?.isCheckedIn && styles.disabled]}>
          <Text style={styles.primaryBtnText}>Check in</Text>
        </Pressable>
        <Pressable disabled={!data?.isCheckedIn || checkOut.isPending} onPress={() => checkOut.mutate()} style={[styles.secondaryBtn, !data?.isCheckedIn && styles.disabled]}>
          <Text style={styles.secondaryBtnText}>Check out</Text>
        </Pressable>
      </HqCard>
      <HqCard>
        <HqCardTitle>Recent sessions</HqCardTitle>
        {(data?.sessions ?? []).length === 0 ? (
          <EmptyState message="No attendance sessions yet." />
        ) : (
          data!.sessions.slice(0, 8).map((s) => (
            <StatRow key={s.id} label={formatDateTime(s.checkInAt)} value={s.durationHours ? `${s.durationHours.toFixed(1)}h` : "Active"} />
          ))
        )}
      </HqCard>
    </HqShell>
  );
}

export function WorkScheduleScreen() {
  const provider = useProviderQuery();
  const bookings = useQuery({
    queryKey: ["partner", "bookings", "upcoming"],
    // ACTIVE_WORK, not "accepted": the latter excludes IN_PROGRESS jobs (backend STATUS_MAP).
    queryFn: () => partnerApi.listBookings({ status: BOOKING_LIST_FILTER.ACTIVE_WORK, limit: 10, sortBy: "upcoming" }),
  });
  if (provider.isLoading) return <HqShell title="Schedule" subtitle="Availability and upcoming jobs"><LoadingBlock /></HqShell>;
  const p = provider.data!;
  return (
    <HqShell title="Schedule Center" subtitle="Availability, working days, and upcoming jobs.">
      <OnlineToggleCard />
      <HqCard>
        <HqCardTitle>Working window</HqCardTitle>
        <StatRow label="Hours" value={`${p.workingHoursStart ?? "—"} – ${p.workingHoursEnd ?? "—"}`} />
        <StatRow label="Days" value={p.workingDays?.join(", ") || "Not set"} />
        <StatRow label="City" value={p.city ?? "—"} />
      </HqCard>
      <HqCard>
        <HqCardTitle>Upcoming jobs</HqCardTitle>
        {bookings.isLoading ? (
          <LoadingBlock />
        ) : (bookings.data?.bookings ?? []).length === 0 ? (
          <EmptyState message="No upcoming or in-progress jobs." />
        ) : (
          bookings.data!.bookings.map((b) => (
            <StatRow key={b.id} label={`${b.service.name} · ${formatDateTime(b.scheduledDate)}`} value={formatCurrency(b.finalAmount || b.amount)} />
          ))
        )}
      </HqCard>
    </HqShell>
  );
}

export function WorkServiceHistoryScreen() {
  const history = useQuery({ queryKey: ["partner", "service-history"], queryFn: () => partnerApi.partnerOs.serviceHistory() });
  const bookings = useQuery({
    // Own key: ["partner","bookings","completed"] is limit 20 elsewhere; one key must mean one query.
    queryKey: ["partner", "bookings", "completed-history"],
    queryFn: () => partnerApi.listBookings({ status: BOOKING_LIST_FILTER.COMPLETED, limit: 15, sortBy: "recent" }),
  });
  if (history.isLoading) return <HqShell title="Service History" subtitle="Work mix"><LoadingBlock /></HqShell>;
  const h = history.data!;
  return (
    <HqShell title="Service History" subtitle="Completed, cancelled, rescheduled, and upcoming work mix.">
      <View style={styles.grid}>
        <KpiCard label="Completed" value={h.completed} />
        <KpiCard label="Cancelled" value={h.cancelled} />
        <KpiCard label="Rescheduled" value={h.rescheduled} />
        <KpiCard label="Upcoming" value={h.upcoming} />
      </View>
      <HqCard>
        <HqCardTitle>Recent completed jobs</HqCardTitle>
        {bookings.isLoading ? (
          <LoadingBlock />
        ) : (bookings.data?.bookings ?? []).length === 0 ? (
          <EmptyState message="No completed jobs yet." />
        ) : (
          bookings.data!.bookings.map((b) => (
            <StatRow key={b.id} label={`${b.service.name} · ${customerName(b.customer)}`} value={formatCurrency(b.finalAmount || b.amount)} />
          ))
        )}
      </HqCard>
    </HqShell>
  );
}

export function RouteCenterScreen() {
  const route = useQuery({ queryKey: ["partner", "route"], queryFn: () => partnerApi.routeOptimize() });
  if (route.isLoading) return <HqShell title="Route Center" subtitle="Optimized route"><LoadingBlock /></HqShell>;
  if (route.isError) return <HqShell title="Route Center" subtitle="Optimized route"><ErrorBlock message="No active stops to optimize right now." /></HqShell>;
  const r = route.data!;
  return (
    <HqShell title="Route Center" subtitle="Optimized multi-stop route with ETA and time saved.">
      <View style={styles.grid}>
        <KpiCard label="Stops" value={r.metrics.stops} />
        <KpiCard label="Distance" value={`${r.metrics.optimizedDistanceKm.toFixed(1)} km`} />
        <KpiCard label="ETA" value={`${Math.round(r.metrics.optimizedEtaMin)} min`} />
        <KpiCard label="Time saved" value={`${Math.round(r.metrics.timeSavedMin)} min`} />
      </View>
      <HqCard>
        <HqCardTitle>Stop sequence</HqCardTitle>
        {r.sequence.length === 0 ? (
          <EmptyState message="No stops in optimized route." />
        ) : (
          r.sequence.map((s) => (
            <StatRow key={`${s.bookingId}-${s.order}`} label={`#${s.order} · ${s.status ?? "pending"}`} value={`${s.cumulativeEtaMin} min`} />
          ))
        )}
      </HqCard>
    </HqShell>
  );
}

export function EarningsHqScreen() {
  const dashboard = useDashboardQuery();
  if (dashboard.isLoading) return <HqShell title="Earnings HQ" subtitle="Overview"><LoadingBlock /></HqShell>;
  const e = dashboard.data!.earnings;
  return (
    <HqShell title="Earnings HQ" subtitle="Today, week, month earnings snapshot.">
      <View style={styles.grid}>
        <KpiCard label="Today" value={formatCurrency(e.today)} />
        <KpiCard label="This week" value={formatCurrency(e.thisWeek)} />
        <KpiCard label="This month" value={formatCurrency(e.thisMonth)} />
        <KpiCard label="Avg / job" value={formatCurrency(e.thisWeek / Math.max(1, dashboard.data!.counts.completedToday || 1))} />
      </View>
      <HqCard>
        <HqCardTitle>Commission tier</HqCardTitle>
        <StatRow label="Rate" value={formatPct(e.commissionRate)} />
        <StatRow label="Weekly gross" value={formatCurrency(e.weeklyGross)} />
        <StatRow label="Take-home %" value={formatPct(e.weeklyTakeHomePct)} />
      </HqCard>
    </HqShell>
  );
}

export function EarningsDetailScreen() {
  const earnings = useQuery({ queryKey: ["partner", "earnings", 30], queryFn: () => partnerApi.earnings(30) });
  if (earnings.isLoading) return <HqShell title="Earnings" subtitle="Period analytics"><LoadingBlock /></HqShell>;
  const e = earnings.data!;
  return (
    <HqShell title="Earnings" subtitle="Period analytics and breakdowns.">
      <View style={styles.grid}>
        <KpiCard label="Period earnings" value={formatCurrency(e.periodEarnings)} />
        <KpiCard label="Total jobs" value={e.totalJobs} />
        <KpiCard label="Avg per job" value={formatCurrency(e.avgPerJob)} />
        <KpiCard label="Lifetime" value={formatCurrency(e.totalEarnings)} />
      </View>
      <HqCard>
        <HqCardTitle>By service</HqCardTitle>
        {(e.byService ?? []).length === 0 ? (
          <EmptyState message="No service breakdown yet." />
        ) : (
          e.byService.map((s) => <StatRow key={s.serviceName} label={s.serviceName} value={formatCurrency(s.earnings)} />)
        )}
      </HqCard>
    </HqShell>
  );
}

export function WalletScreen({ embedded }: { embedded?: boolean }) {
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const payouts = useQuery({ queryKey: ["partner", "payouts"], queryFn: () => partnerApi.payouts() });
  const txns = useQuery({ queryKey: ["partner", "wallet-txns"], queryFn: () => partnerApi.walletTransactions({ limit: 8 }) });

  const loading = payouts.isLoading;
  const available = payouts.data?.availableBalance ?? 0;
  const pending = payouts.data?.pendingBalance ?? 0;
  const total = payouts.data?.currentBalance ?? 0;

  const body = loading ? (
    <LoadingBlock label="Loading wallet…" />
  ) : payouts.isError ? (
    <ErrorBlock message="Could not load wallet balance." />
  ) : (
    <>
      <View style={styles.grid} accessibilityLabel="Wallet balance summary">
        <KpiCard label="Available" value={formatCurrency(available)} />
        <KpiCard label="Pending" value={formatCurrency(pending)} />
        <KpiCard label="Total" value={formatCurrency(total)} />
      </View>
      <Pressable
        onPress={() => setWithdrawOpen(true)}
        disabled={available <= 0}
        style={[styles.primaryBtn, available <= 0 && styles.disabled]}
        accessibilityRole="button"
        accessibilityLabel="Withdraw to bank"
        testID="wallet-withdraw-cta"
      >
        <Text style={styles.primaryBtnText}>{available <= 0 ? "No balance to withdraw" : "Withdraw to bank"}</Text>
      </Pressable>
      <HqCard>
        <HqCardTitle>Recent transactions</HqCardTitle>
        {txns.isLoading ? (
          <LoadingBlock label="Loading transactions…" />
        ) : (txns.data?.transactions ?? []).length === 0 ? (
          <EmptyState message="No transactions yet." />
        ) : (
          txns.data!.transactions.map((t) => (
            <StatRow key={t.id} label={t.description || t.type} value={formatCurrency(t.amount)} />
          ))
        )}
      </HqCard>
      <WithdrawSheet
        visible={withdrawOpen}
        availableBalance={available}
        onClose={() => setWithdrawOpen(false)}
      />
    </>
  );
  if (embedded) return <>{body}</>;
  return <HqShell title="Wallet" subtitle="Balance, withdraw, and recent transactions.">{body}</HqShell>;
}

export function WalletLedgerScreen() {
  const txns = useQuery({ queryKey: ["partner", "wallet-txns-all"], queryFn: () => partnerApi.walletTransactions({ limit: 50 }) });
  return (
    <HqShell title="Wallet Ledger" subtitle="Full transaction history.">
      <HqCard>
        {txns.isLoading ? (
          <LoadingBlock />
        ) : (txns.data?.transactions ?? []).length === 0 ? (
          <EmptyState message="No ledger entries." />
        ) : (
          txns.data!.transactions.map((t) => (
            <StatRow key={t.id} label={`${t.type} · ${formatDate(t.createdAt)}`} value={formatCurrency(t.amount)} />
          ))
        )}
      </HqCard>
    </HqShell>
  );
}

export function EarningsPayoutsScreen() {
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const payouts = useQuery({ queryKey: ["partner", "payouts"], queryFn: () => partnerApi.payouts() });
  if (payouts.isLoading) return <HqShell title="Payouts" subtitle="Withdrawals"><LoadingBlock label="Loading payout history…" /></HqShell>;
  if (payouts.isError) return <HqShell title="Payouts" subtitle="Withdrawals"><ErrorBlock message="Could not load payout data." /></HqShell>;
  const p = payouts.data!;
  return (
    <HqShell title="Payouts" subtitle="Withdrawal history and settlement status.">
      <View style={styles.grid}>
        <KpiCard label="Available" value={formatCurrency(p.availableBalance)} />
        <KpiCard label="Pending" value={formatCurrency(p.pendingBalance)} />
        <KpiCard label="Lifetime" value={formatCurrency(p.lifetimeEarnings)} />
      </View>
      <Pressable
        onPress={() => setWithdrawOpen(true)}
        disabled={p.availableBalance <= 0}
        style={[styles.primaryBtn, p.availableBalance <= 0 && styles.disabled]}
        accessibilityRole="button"
        accessibilityLabel="Request withdrawal"
        testID="payouts-withdraw-cta"
      >
        <Text style={styles.primaryBtnText}>Request withdrawal</Text>
      </Pressable>
      <HqCard>
        <HqCardTitle>Next payout</HqCardTitle>
        <StatRow label="Date" value={p.nextPayoutDate ? formatDate(p.nextPayoutDate) : "—"} />
      </HqCard>
      <HqCard>
        <HqCardTitle>Withdrawal history</HqCardTitle>
        {(p.withdrawals ?? []).length === 0 ? (
          <EmptyState message="No payout history yet." />
        ) : (
          p.withdrawals.map((w) => (
            <View key={w.id} style={styles.payoutRow} accessibilityLabel={`Withdrawal ${w.reference} ${formatPayoutStatus(w.status)}`}>
              <View style={styles.payoutRowTop}>
                <Text style={styles.payoutRef}>{w.reference}</Text>
                <Text style={styles.payoutAmount}>{formatCurrency(w.netAmount ?? w.amount)}</Text>
              </View>
              <Text style={styles.payoutMeta}>
                {formatPayoutStatus(w.status)}
                {w.bank ? ` · ${w.bank}` : ""}
                {w.settlementDate ? ` · Settled ${formatDate(w.settlementDate)}` : ""}
              </Text>
            </View>
          ))
        )}
      </HqCard>
      <WithdrawSheet
        visible={withdrawOpen}
        availableBalance={p.availableBalance}
        onClose={() => setWithdrawOpen(false)}
      />
    </HqShell>
  );
}

export function EarningsIncentivesScreen() {
  const incentives = useQuery({ queryKey: ["partner", "incentives"], queryFn: () => partnerApi.partnerOs.incentives() });
  if (incentives.isLoading) return <HqShell title="Incentives" subtitle="Bonus progress"><LoadingBlock label="Loading incentives…" /></HqShell>;
  if (incentives.isError) return <HqShell title="Incentives" subtitle="Bonus progress"><ErrorBlock message="Incentive data unavailable." /></HqShell>;
  const data = incentives.data!;
  return (
    <HqShell title="Incentives" subtitle="Bonus rules, progress, and paid rewards.">
      <KpiCard label="Streak days" value={data.streakDays} />
      <HqCard>
        <HqCardTitle>Active rules</HqCardTitle>
        {data.rules.length === 0 ? (
          <EmptyState message="No incentives available." />
        ) : (
          data.rules.map((r) => {
            const remaining = Math.max(0, r.threshold - r.current);
            const statusLabel = r.paid ? "Paid" : r.eligible ? "Qualified" : "In progress";
            return (
              <View key={r.id} style={styles.incentiveRow} accessibilityLabel={`${r.name} ${statusLabel}`}>
                <View style={styles.incentiveHeader}>
                  <Text style={styles.incentiveName}>{r.name}</Text>
                  <Text style={styles.incentiveBonus}>{formatCurrency(r.paid ? (r.payoutAmount ?? r.bonusAmount) : r.bonusAmount)}</Text>
                </View>
                <Text style={styles.incentiveMeta}>
                  {r.current} / {r.threshold} {r.metric.replace(/_/g, " ")} · {r.period}
                </Text>
                {!r.paid && remaining > 0 ? (
                  <Text style={styles.incentiveRemaining}>{remaining} remaining</Text>
                ) : null}
                <ProgressRow label={statusLabel} pct={r.progressPct} />
              </View>
            );
          })
        )}
      </HqCard>
      {(data.payouts ?? []).length > 0 ? (
        <HqCard>
          <HqCardTitle>Recent incentive payouts</HqCardTitle>
          {data.payouts.slice(0, 8).map((p) => (
            <StatRow
              key={p.id}
              label={`${p.rule?.name ?? "Bonus"} · ${formatDate(p.createdAt)}`}
              value={formatCurrency(p.amount)}
            />
          ))}
        </HqCard>
      ) : null}
    </HqShell>
  );
}

export function EarningsTaxScreen() {
  const tax = useQuery({ queryKey: ["partner", "tax"], queryFn: () => partnerApi.taxSummary() });
  if (tax.isLoading) return <HqShell title="Tax Center" subtitle="GST and TDS"><LoadingBlock /></HqShell>;
  const t = tax.data!;
  return (
    <HqShell title="Tax Center" subtitle="GST, TDS, gross/net/settled tax summary.">
      <HqCard>
        <StatRow label="Financial year" value={t.financialYear} />
        <StatRow label="Gross earnings" value={formatCurrency(t.grossEarnings)} />
        <StatRow label="Platform commission" value={formatCurrency(t.platformCommission)} />
        <StatRow label="Net earnings" value={formatCurrency(t.netEarnings)} />
        <StatRow label="Settled out" value={formatCurrency(t.settledOut)} />
        <StatRow label="GST on commission" value={formatCurrency(t.gstOnCommission ?? 0)} />
        <StatRow label="TDS estimate" value={formatCurrency(t.tdsEstimate ?? 0)} />
        <StatRow label="Estimated tax" value={formatCurrency(t.estimatedTax)} />
      </HqCard>
    </HqShell>
  );
}

export function EarningsForecastScreen() {
  const forecast = useQuery({ queryKey: ["partner", "forecast"], queryFn: () => partnerApi.partnerOs.forecast() });
  if (forecast.isLoading) return <HqShell title="Forecast" subtitle="Projections"><LoadingBlock /></HqShell>;
  const f = forecast.data!;
  return (
    <HqShell title="Earnings Forecast" subtitle="Today, weekly, and monthly projections.">
      <View style={styles.grid}>
        <KpiCard label="Today" value={formatCurrency(f.todayProjection)} />
        <KpiCard label="Weekly" value={formatCurrency(f.weeklyProjection)} />
        <KpiCard label="Monthly" value={formatCurrency(f.monthlyProjection)} />
      </View>
      <HqCard>
        <HqCardTitle>Forecast inputs</HqCardTitle>
        {Object.entries(f.inputs).map(([k, v]) => (
          <StatRow key={k} label={k} value={String(v)} />
        ))}
      </HqCard>
    </HqShell>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12, marginBottom: 4 },
  primaryBtn: { marginTop: 4, marginBottom: 8, backgroundColor: partnerColors.primary, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  primaryBtnText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  secondaryBtn: { marginTop: 8, borderWidth: 1, borderColor: partnerColors.primary, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  secondaryBtnText: { color: partnerColors.primary, fontWeight: "700" },
  toggleBtn: { marginTop: 12, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  toggleOn: { backgroundColor: partnerColors.danger },
  toggleOff: { backgroundColor: partnerColors.primary },
  toggleText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  presenceWarn: { marginTop: 8, color: partnerColors.warning, fontSize: 13 },
  disabled: { opacity: 0.5 },
  payoutRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: partnerColors.line },
  payoutRowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  payoutRef: { fontSize: 14, fontWeight: "600", color: partnerColors.text, flex: 1 },
  payoutAmount: { fontSize: 14, fontWeight: "700", color: partnerColors.text },
  payoutMeta: { marginTop: 4, fontSize: 12, color: partnerColors.textMuted },
  incentiveRow: { marginBottom: 14 },
  incentiveHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  incentiveName: { fontSize: 15, fontWeight: "600", color: partnerColors.text, flex: 1 },
  incentiveBonus: { fontSize: 15, fontWeight: "700", color: partnerColors.text },
  incentiveMeta: { marginTop: 4, fontSize: 12, color: partnerColors.textMuted },
  incentiveRemaining: { marginTop: 2, fontSize: 12, color: partnerColors.primary, fontWeight: "600" },
});
