import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  Bell,
  ClipboardList,
  Compass,
  LayoutGrid,
  Star,
  TrendingUp,
  Wallet,
} from "lucide-react-native";
import { StyleSheet, Text, View } from "react-native";
import { EmptyState, HqCard, HqCardTitle, HqLinkRow, LoadingBlock, StatRow } from "@/components/HqUi";
import { KpiCard } from "@/components/KpiCard";
import { PartnerScreen } from "@/components/PartnerScreen";
import { customerName, formatCurrency, formatDateTime, formatPct } from "@/lib/format";
import { partnerApi } from "@/services/partner-api";
import { OnlineToggleCard } from "@/screens/hq-work-earnings";
import { useAuthStore } from "@/stores/auth-store";
import { partnerColors } from "@/theme/colors";

export default function HomeTab() {
  const user = useAuthStore((s) => s.user);
  const firstName = user?.firstName ?? "Partner";

  const dashboard = useQuery({
    queryKey: ["partner", "dashboard"],
    queryFn: () => partnerApi.dashboard(),
  });
  const pending = useQuery({
    queryKey: ["partner", "bookings", "pending-home"],
    queryFn: () => partnerApi.listBookings({ status: "pending", limit: 3, sortBy: "recent" }),
  });
  const schedule = useQuery({
    queryKey: ["partner", "bookings", "today"],
    queryFn: () => partnerApi.listBookings({ status: "accepted", limit: 5, sortBy: "upcoming" }),
  });

  const d = dashboard.data;
  const counts = d?.counts;
  const earnings = d?.earnings;

  return (
    <PartnerScreen title={`Hello, ${firstName}`} subtitle="Your live partner command center — same data as partner-web.">
      {dashboard.isLoading ? <LoadingBlock /> : null}
      {d ? (
        <>
          <View style={styles.grid}>
            <KpiCard label="Today's earnings" value={formatCurrency(earnings?.today ?? 0)} icon={Wallet} />
            <KpiCard label="Completed today" value={counts?.completedToday ?? 0} icon={TrendingUp} />
            <KpiCard label="Pending requests" value={counts?.pendingRequests ?? 0} icon={Bell} />
            <KpiCard label="Rating" value={d.rating.toFixed(1)} icon={Star} />
            <KpiCard label="Acceptance" value={formatPct(d.rates.acceptanceRate)} icon={BarChart3} />
            <KpiCard label="Wallet" value={formatCurrency(d.walletBalance)} icon={Wallet} />
          </View>

          <OnlineToggleCard />

          <HqCard>
            <HqCardTitle>New booking requests</HqCardTitle>
            {pending.isLoading ? (
              <LoadingBlock />
            ) : (pending.data?.bookings ?? []).length === 0 ? (
              <EmptyState message="No pending requests — you're all caught up!" />
            ) : (
              pending.data!.bookings.map((b) => (
                <StatRow key={b.id} label={`${b.service.name} · ${customerName(b.customer)}`} value={formatCurrency(b.finalAmount || b.amount)} />
              ))
            )}
            <HqLinkRow label="View all requests" subtitle="Accept, start, and complete jobs" icon={ClipboardList} onPress={() => router.push("/(tabs)/requests")} />
          </HqCard>

          <HqCard>
            <HqCardTitle>Today's schedule</HqCardTitle>
            {schedule.isLoading ? (
              <LoadingBlock />
            ) : (schedule.data?.bookings ?? []).length === 0 ? (
              <EmptyState message="No upcoming jobs scheduled." />
            ) : (
              schedule.data!.bookings.map((b) => (
                <StatRow key={b.id} label={b.service.name} value={formatDateTime(b.scheduledDate)} />
              ))
            )}
          </HqCard>

          <HqCard>
            <HqCardTitle>Performance snapshot</HqCardTitle>
            <StatRow label="Completion rate" value={formatPct(d.rates.completionRate)} />
            <StatRow label="Response rate" value={formatPct(d.rates.responseRate)} />
            <StatRow label="On-time rate" value={formatPct(d.rates.onTimeRate)} />
            <StatRow label="Commission tier" value={formatPct(earnings?.commissionRate ?? 0)} />
          </HqCard>

          <HqCard>
            <HqCardTitle>Quick access</HqCardTitle>
            <HqLinkRow label="Partner OS modules" subtitle="All HQ sections from partner-web" icon={LayoutGrid} onPress={() => router.push("/(tabs)/explore")} />
            <HqLinkRow label="Route Center" subtitle="Optimized multi-stop route" icon={Compass} onPress={() => router.push("/hq/route-center")} />
            <HqLinkRow label="AI Assistant" subtitle="Smart insights from your data" icon={BarChart3} onPress={() => router.push("/hq/ai-assistant")} />
          </HqCard>
        </>
      ) : null}
      {dashboard.isError ? <Text style={styles.error}>Could not load dashboard. Check backend connection.</Text> : null}
    </PartnerScreen>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  error: { marginTop: 12, color: partnerColors.danger, fontSize: 13 },
});
