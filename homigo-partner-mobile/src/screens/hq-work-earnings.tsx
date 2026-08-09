import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import * as Location from "expo-location";
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import { KpiCard } from "@/components/KpiCard";
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
import { customerName, formatCurrency, formatDate, formatDateTime, formatPct, onlineHours } from "@/lib/format";
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
  const provider = useProviderQuery();
  const toggle = useMutation({
    mutationFn: (online: boolean) => partnerApi.setOnline(online),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["partner", "provider"] });
      void qc.invalidateQueries({ queryKey: ["partner", "dashboard"] });
    },
  });
  const online = provider.data?.isOnline ?? false;
  return (
    <HqCard>
      <HqCardTitle>Availability</HqCardTitle>
      <HqMuted>{online ? "You are online and receiving requests." : "Go online to receive live booking requests."}</HqMuted>
      <Pressable
        onPress={() => toggle.mutate(!online)}
        disabled={toggle.isPending}
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
    queryFn: () => partnerApi.listBookings({ status: "accepted", limit: 10, sortBy: "upcoming" }),
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
          <EmptyState message="No upcoming accepted jobs." />
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
    queryKey: ["partner", "bookings", "completed"],
    queryFn: () => partnerApi.listBookings({ status: "completed", limit: 15, sortBy: "recent" }),
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
  const balance = useQuery({ queryKey: ["partner", "wallet"], queryFn: () => partnerApi.walletBalance() });
  const txns = useQuery({ queryKey: ["partner", "wallet-txns"], queryFn: () => partnerApi.walletTransactions({ limit: 8 }) });
  const body = balance.isLoading ? (
    <LoadingBlock />
  ) : (
    <>
      <View style={styles.grid}>
        <KpiCard label="Available" value={formatCurrency(balance.data?.availableBalance ?? 0)} />
        <KpiCard label="Reserved" value={formatCurrency(balance.data?.reservedBalance ?? 0)} />
        <KpiCard label="Total" value={formatCurrency(balance.data?.totalBalance ?? 0)} />
      </View>
      <HqCard>
        <HqCardTitle>Recent transactions</HqCardTitle>
        {txns.isLoading ? (
          <LoadingBlock />
        ) : (txns.data?.transactions ?? []).length === 0 ? (
          <EmptyState message="No transactions yet." />
        ) : (
          txns.data!.transactions.map((t) => (
            <StatRow key={t.id} label={t.description || t.type} value={formatCurrency(t.amount)} />
          ))
        )}
      </HqCard>
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
  const payouts = useQuery({ queryKey: ["partner", "payouts"], queryFn: () => partnerApi.payouts() });
  if (payouts.isLoading) return <HqShell title="Payouts" subtitle="Withdrawals"><LoadingBlock /></HqShell>;
  const p = payouts.data!;
  return (
    <HqShell title="Payouts" subtitle="Withdrawal history and next payout date.">
      <View style={styles.grid}>
        <KpiCard label="Pending" value={formatCurrency(p.pendingAmount)} />
        <KpiCard label="Lifetime paid" value={formatCurrency(p.lifetimePaid)} />
      </View>
      <HqCard>
        <HqCardTitle>Next payout</HqCardTitle>
        <StatRow label="Date" value={p.nextPayoutDate ? formatDate(p.nextPayoutDate) : "—"} />
      </HqCard>
      <HqCard>
        <HqCardTitle>Withdrawal history</HqCardTitle>
        {(p.withdrawals ?? []).length === 0 ? (
          <EmptyState message="No withdrawals yet." />
        ) : (
          p.withdrawals.map((w) => (
            <StatRow key={w.id} label={`${w.withdrawalNumber} · ${w.status}`} value={formatCurrency(w.amount)} />
          ))
        )}
      </HqCard>
    </HqShell>
  );
}

export function EarningsIncentivesScreen() {
  const incentives = useQuery({ queryKey: ["partner", "incentives"], queryFn: () => partnerApi.partnerOs.incentives() });
  if (incentives.isLoading) return <HqShell title="Incentives" subtitle="Bonus progress"><LoadingBlock /></HqShell>;
  const data = incentives.data!;
  return (
    <HqShell title="Incentives" subtitle="Bonus rules, progress bars, and streak days.">
      <KpiCard label="Streak days" value={data.streakDays} />
      <HqCard>
        <HqCardTitle>Active rules</HqCardTitle>
        {data.rules.length === 0 ? (
          <EmptyState message="No active incentive rules." />
        ) : (
          data.rules.map((r) => <ProgressRow key={r.id} label={r.name} pct={r.progressPct} />)
        )}
      </HqCard>
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
  primaryBtn: { marginTop: 10, backgroundColor: partnerColors.primary, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  primaryBtnText: { color: "#fff", fontWeight: "700" },
  secondaryBtn: { marginTop: 8, borderWidth: 1, borderColor: partnerColors.primary, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  secondaryBtnText: { color: partnerColors.primary, fontWeight: "700" },
  toggleBtn: { marginTop: 12, borderRadius: 12, paddingVertical: 14, alignItems: "center" },
  toggleOn: { backgroundColor: partnerColors.danger },
  toggleOff: { backgroundColor: partnerColors.primary },
  toggleText: { color: "#fff", fontWeight: "700", fontSize: 15 },
  disabled: { opacity: 0.5 },
});
