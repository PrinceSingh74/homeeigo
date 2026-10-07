import { useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import { Award, BarChart3, Calendar, ClipboardList, FileCheck2, Navigation2, Route, Wallet } from "lucide-react-native";
import { useState } from "react";
import { KpiCard } from "@/components/KpiCard";
import { WithdrawSheet } from "@/components/WithdrawSheet";
import { AttendanceBody, useAttendanceActions } from "@/components/money/Attendance";
import { BalanceHeader } from "@/components/money/BalanceHeader";
import { Block, Grid, HqScreen, Loadable } from "@/components/money/DataScreen";
import { JobEarningsList } from "@/components/money/JobEarnings";
import { OnlineToggleCard } from "@/components/money/OnlineToggleCard";
import { PeriodEarnings } from "@/components/money/PeriodEarnings";
import { WithdrawalList } from "@/components/money/Withdrawals";
import { ProgressRow } from "@/components/HqUi";
import { Banner, Button, Card, EmptyState, KeyValue, ListRow, Pill, T } from "@/components/ui";
import {
  K,
  useAttendanceQuery,
  useDashboardQuery,
  useForecastQuery,
  useIncentivesQuery,
  useInvoicesQuery,
  usePayoutsQuery,
  useProviderQuery,
  useRouteQuery,
  useServiceHistoryQuery,
  useTaxSummaryQuery,
  useWithdrawalsQuery,
} from "@/hooks/money/queries";
import { BOOKING_LIST_FILTER } from "@/lib/booking-status";
import { customerName } from "@/lib/format";
import { confidencePercent, count, formatDay, formatDayTime, humanise, percent, rupees } from "@/lib/money-format";
import { partnerApi } from "@/services/partner-api";
import type { PartnerBooking, RouteOptimizeResult } from "@/types/partner";

/**
 * The Work and Earnings screens. Each one is a thin composition: the reads live in
 * `hooks/money/queries`, the pieces in `components/money`, the wording rules in `lib/money-*`.
 * Every figure on these screens is a field the server sent, under a label that says what it is.
 */

// Other screens import these three from here.
export { OnlineToggleCard, useDashboardQuery, useProviderQuery };

/* ------------------------------------------------------------------ work */

export function WorkHqScreen() {
  const dashboard = useDashboardQuery();
  return (
    <HqScreen title="Work HQ" subtitle="Requests, jobs and your online status." refresh={[K.dashboard, K.operations, K.provider]}>
      <Loadable query={dashboard} errorTitle="Could not load your work summary" loadingLabel="Loading your work summary…" loadingCards={1}>
        {(d) => (
          <>
            <Grid>
              <KpiCard label="Live requests" value={count(d.counts.pendingRequests)} />
              <KpiCard label="Active jobs" value={count(d.counts.activeBookings)} />
              <KpiCard label="Completed today" value={count(d.counts.completedToday)} />
            </Grid>
            {d.isOnline && d.onlineSince ? (
              <Card>
                <KeyValue label="Online since" value={formatDayTime(d.onlineSince)} />
              </Card>
            ) : null}
          </>
        )}
      </Loadable>
      <OnlineToggleCard />
    </HqScreen>
  );
}

export function WorkAttendanceScreen() {
  const attendance = useAttendanceQuery();
  const { checkIn, checkOut, outcome } = useAttendanceActions();
  const data = attendance.data;
  const busy = checkIn.isPending || checkOut.isPending;
  return (
    <HqScreen
      title="Attendance"
      subtitle="Check in when you start, check out when you finish."
      refresh={[K.attendance]}
      footer={
        data ? (
          data.isCheckedIn ? (
            <Button label="Check out" onPress={() => checkOut.mutate()} loading={checkOut.isPending} disabled={busy} testID="attendance-check-out" />
          ) : (
            <Button label="Check in" onPress={() => checkIn.mutate()} loading={checkIn.isPending} disabled={busy} testID="attendance-check-in" />
          )
        ) : undefined
      }
    >
      <Loadable query={attendance} errorTitle="Could not load attendance" loadingLabel="Loading attendance…">
        {(a) => <AttendanceBody attendance={a} outcome={outcome} />}
      </Loadable>
    </HqScreen>
  );
}

function JobRows({ bookings, empty }: { bookings: PartnerBooking[]; empty: { title: string; message: string } }) {
  if (bookings.length === 0) {
    return (
      <Card>
        <EmptyState icon={ClipboardList} title={empty.title} message={empty.message} />
      </Card>
    );
  }
  return (
    <Card>
      {bookings.map((b, i) => (
        <ListRow
          key={b.id}
          icon={Calendar}
          title={b.service?.name ?? b.bookingNumber}
          subtitle={`${formatDayTime(b.scheduledDate)} · ${customerName(b.customer)} · ${humanise(b.status)}`}
          onPress={() => router.push(`/job/${b.id}`)}
          last={i === bookings.length - 1}
        />
      ))}
    </Card>
  );
}

const UPCOMING_LIMIT = 10;
const COMPLETED_LIMIT = 15;

export function WorkScheduleScreen() {
  const provider = useProviderQuery();
  const bookings = useQuery({
    queryKey: ["partner", "bookings", "upcoming"],
    // ACTIVE_WORK, not "accepted": the latter excludes IN_PROGRESS jobs (backend STATUS_MAP).
    queryFn: () => partnerApi.listBookings({ status: BOOKING_LIST_FILTER.ACTIVE_WORK, limit: UPCOMING_LIMIT, sortBy: "upcoming" }),
  });
  return (
    <HqScreen title="Schedule" subtitle="Your working window and the jobs you hold." refresh={[K.provider, K.operations, K.bookings]}>
      <OnlineToggleCard />
      <Block title="Working window">
        <Loadable query={provider} errorTitle="Could not load your working window" loadingCards={1}>
          {(p) => (
            <Card>
              <KeyValue label="Hours" value={p.workingHoursStart && p.workingHoursEnd ? `${p.workingHoursStart} – ${p.workingHoursEnd}` : "Not set"} />
              <KeyValue label="Days" value={p.workingDays?.length ? p.workingDays.map((d) => humanise(d)).join(", ") : "Not set"} />
              <KeyValue label="City" value={p.city ?? "Not set"} />
            </Card>
          )}
        </Loadable>
      </Block>
      <Block title="Jobs you hold">
        <Loadable query={bookings} errorTitle="Could not load your jobs" loadingCards={1}>
          {(list) => (
            <>
              <JobRows bookings={list.bookings ?? []} empty={{ title: "No jobs right now", message: "Jobs you accept appear here in the order they are scheduled." }} />
              {(list.bookings ?? []).length > 0 ? <T kind="small">{`Showing the next ${list.bookings.length} of ${list.total}.`}</T> : null}
            </>
          )}
        </Loadable>
      </Block>
    </HqScreen>
  );
}

export function WorkServiceHistoryScreen() {
  const history = useServiceHistoryQuery();
  const bookings = useQuery({
    // Own key: ["partner","bookings","completed"] is limit 20 elsewhere; one key must mean one query.
    queryKey: ["partner", "bookings", "completed-history"],
    queryFn: () => partnerApi.listBookings({ status: BOOKING_LIST_FILTER.COMPLETED, limit: COMPLETED_LIMIT, sortBy: "recent" }),
  });
  return (
    <HqScreen title="Service history" subtitle="How your jobs ended." refresh={[K.serviceHistory, K.bookings]}>
      <Loadable query={history} errorTitle="Could not load your service history" loadingCards={1}>
        {(h) => (
          <>
            <Grid>
              <KpiCard label="Completed" value={count(h.completed)} />
              <KpiCard label="Cancelled" value={count(h.cancelled)} />
              <KpiCard label="Open now" value={count(h.upcoming)} />
            </Grid>
            <T kind="small">Counted over your latest 500 jobs.</T>
          </>
        )}
      </Loadable>
      <Block title="Recently completed">
        <Loadable query={bookings} errorTitle="Could not load completed jobs" loadingCards={1}>
          {(list) => (
            <>
              <JobRows bookings={list.bookings ?? []} empty={{ title: "No completed jobs yet", message: "Jobs you complete appear here." }} />
              {(list.bookings ?? []).length > 0 ? <T kind="small">{`Showing the latest ${list.bookings.length} of ${list.total}. What each job paid you is in your wallet.`}</T> : null}
            </>
          )}
        </Loadable>
      </Block>
    </HqScreen>
  );
}

/** The optimised route as the server computed it; shared by Route Center and the AI route screen. */
export function RouteSummary({ route }: { route: RouteOptimizeResult }) {
  const sequence = Array.isArray(route.sequence) ? route.sequence : [];
  if (sequence.length === 0) {
    return (
      <Card>
        <EmptyState icon={Route} title="No stops to route" message="When you hold active jobs, the order to visit them appears here." testID="route-empty" />
      </Card>
    );
  }
  return (
    <>
      <Grid>
        <KpiCard label="Stops" value={count(route.metrics.stops)} />
        <KpiCard label="Distance" value={`${route.metrics.optimizedDistanceKm.toFixed(1)} km`} />
        <KpiCard label="Travel time" value={`${Math.round(route.metrics.optimizedEtaMin)} min`} />
        <KpiCard label="Saved against the unsorted order" value={`${Math.round(route.metrics.timeSavedMin)} min`} />
      </Grid>
      <Block title="Stop sequence" caption={`Estimated by: ${route.metrics.source}`}>
        <Card>
          {sequence.map((s, i) => (
            <ListRow
              key={`${s.bookingId}-${s.order}`}
              icon={Navigation2}
              title={`Stop ${s.order}`}
              subtitle={`${humanise(s.status)} · ${s.distanceFromPrevKm.toFixed(1)} km from the previous point`}
              value={`${Math.round(s.cumulativeEtaMin)} min`}
              onPress={() => router.push(`/job/${s.bookingId}`)}
              last={i === sequence.length - 1}
            />
          ))}
        </Card>
      </Block>
    </>
  );
}

export function RouteCenterScreen() {
  const route = useRouteQuery();
  return (
    <HqScreen title="Route Center" subtitle="The order to visit the jobs you hold." refresh={[K.route]}>
      <Loadable query={route} errorTitle="Could not work out a route" loadingLabel="Working out your route…">
        {(r) => <RouteSummary route={r} />}
      </Loadable>
    </HqScreen>
  );
}

/* --------------------------------------------------------------- earnings */

export function EarningsHqScreen() {
  const dashboard = useDashboardQuery();
  return (
    <HqScreen title="Earnings HQ" subtitle="Your net earnings at a glance." refresh={[K.dashboard]}>
      <Loadable query={dashboard} errorTitle="Could not load your earnings" loadingLabel="Loading your earnings…">
        {(d) => (
          <>
            <Grid>
              <KpiCard label="Today (net)" value={rupees(d.earnings.today)} />
              <KpiCard label="Yesterday (net)" value={rupees(d.earnings.yesterday)} />
              <KpiCard label="Last 7 days (net)" value={rupees(d.earnings.thisWeek)} />
              <KpiCard label="Last 30 days (net)" value={rupees(d.earnings.thisMonth)} />
            </Grid>
            <Block title="Last 7 days" caption="Days are counted in UTC. Only earnings credited to you are included.">
              <Card>
                <KeyValue label="Gross" value={rupees(d.earnings.weeklyGross)} />
                <KeyValue label="Platform commission" value={rupees(d.earnings.weeklyCommission)} />
                <KeyValue label="Net" value={rupees(d.earnings.thisWeek)} strong />
                <KeyValue label="Net as a share of gross" value={percent(d.earnings.weeklyTakeHomePct)} />
              </Card>
            </Block>
            <Block title="Commission" caption="Set by the number of jobs you have completed this calendar month.">
              <Card>
                <KeyValue label="Your current commission rate" value={percent(d.earnings.commissionRate)} />
              </Card>
            </Block>
          </>
        )}
      </Loadable>
      <Card>
        <ListRow icon={BarChart3} title="Earnings by period" subtitle="7, 30 or 90 days, day by day" onPress={() => router.push("/hq/earnings-detail")} />
        <ListRow icon={Wallet} title="Wallet" subtitle="Balance, withdrawals and job earnings" onPress={() => router.push("/hq/wallet")} last />
      </Card>
    </HqScreen>
  );
}

export function EarningsDetailScreen() {
  return (
    <HqScreen title="Earnings" subtitle="What you earned in a period, day by day." refresh={[K.earnings]}>
      <PeriodEarnings />
    </HqScreen>
  );
}

/**
 * Opens the withdraw sheet. It waits only for the balance to have loaded once: the figure on this
 * screen is a cached one, so it never decides "nothing to withdraw" — the sheet reads the balance
 * again when it opens and says so from the fresh figure.
 */
function WithdrawFooter({ available, onPress, testID }: { available: number | undefined; onPress: () => void; testID: string }) {
  return <Button label="Withdraw to bank" onPress={onPress} disabled={available === undefined} testID={testID} />;
}

export function WalletScreen({ embedded }: { embedded?: boolean }) {
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const payouts = usePayoutsQuery();
  const withdrawals = useWithdrawalsQuery();
  const invoices = useInvoicesQuery();
  const available = payouts.data?.availableBalance;
  return (
    <HqScreen
      title="Wallet"
      subtitle="What you are owed, and what has been paid out."
      showBack={!embedded}
      refresh={[K.payouts, K.withdrawals, K.invoices]}
      footer={<WithdrawFooter available={available} onPress={() => setWithdrawOpen(true)} testID="wallet-withdraw-cta" />}
    >
      <Loadable query={payouts} errorTitle="Could not load wallet" loadingLabel="Loading wallet…" loadingCards={1}>
        {(p) => <BalanceHeader payouts={p} />}
      </Loadable>

      <Block title="Recent withdrawals">
        <Loadable query={withdrawals} errorTitle="Could not load withdrawals" loadingLabel="Loading withdrawals…" loadingCards={1}>
          {(list) => <WithdrawalList withdrawals={list} initiallyShown={3} onSeeAll={() => router.push("/hq/earnings-payouts")} />}
        </Loadable>
      </Block>

      <Block title="Job earnings">
        <Loadable query={invoices} errorTitle="Could not load job earnings" loadingLabel="Loading job earnings…" loadingCards={1}>
          {(inv) => <JobEarningsList earnings={inv.earnings ?? []} />}
        </Loadable>
      </Block>

      <Block title="More">
        <Card>
          <ListRow icon={BarChart3} title="Earnings by period" subtitle="7, 30 or 90 days, day by day" onPress={() => router.push("/hq/earnings-detail")} />
          <ListRow icon={Award} title="Incentives" subtitle="Bonus progress and paid rewards" onPress={() => router.push("/hq/earnings-incentives")} />
          <ListRow icon={FileCheck2} title="Tax summary" subtitle="All-time totals and the server's estimate" onPress={() => router.push("/hq/earnings-tax")} last />
        </Card>
      </Block>

      <WithdrawSheet visible={withdrawOpen} onClose={() => setWithdrawOpen(false)} />
    </HqScreen>
  );
}

/** Every withdrawal the server lists (the latest 20), with balances and the withdraw action. */
export function EarningsPayoutsScreen() {
  const [withdrawOpen, setWithdrawOpen] = useState(false);
  const payouts = usePayoutsQuery();
  const withdrawals = useWithdrawalsQuery();
  const available = payouts.data?.availableBalance;
  return (
    <HqScreen
      title="Withdrawals"
      subtitle="Your withdrawal requests and where each one stands."
      refresh={[K.payouts, K.withdrawals]}
      footer={<WithdrawFooter available={available} onPress={() => setWithdrawOpen(true)} testID="payouts-withdraw-cta" />}
    >
      <Loadable query={payouts} errorTitle="Could not load your balance" loadingLabel="Loading your balance…" loadingCards={1}>
        {(p) => (
          <Card>
            <KeyValue label="Available to withdraw" value={rupees(p.availableBalance)} strong />
            <KeyValue label="Withdrawals in progress" value={rupees(p.pendingBalance)} />
          </Card>
        )}
      </Loadable>
      <Block title="Latest withdrawals" caption="The server lists your latest 20 withdrawals. Tap one for its dates, attempts and any failure reason.">
        <Loadable query={withdrawals} errorTitle="Could not load withdrawals" loadingLabel="Loading withdrawals…">
          {(list) => <WithdrawalList withdrawals={list} />}
        </Loadable>
      </Block>
      <WithdrawSheet visible={withdrawOpen} onClose={() => setWithdrawOpen(false)} />
    </HqScreen>
  );
}

export function EarningsIncentivesScreen() {
  const incentives = useIncentivesQuery();
  return (
    <HqScreen title="Incentives" subtitle="Bonus rules, your progress and what has been paid." refresh={[K.incentives]}>
      <Loadable query={incentives} errorTitle="Could not load incentives" loadingLabel="Loading incentives…">
        {(data) => {
          const rules = Array.isArray(data.rules) ? data.rules : [];
          const paid = Array.isArray(data.payouts) ? data.payouts : [];
          return (
            <>
              <Grid>
                <KpiCard label="Streak days" value={count(data.streakDays)} />
              </Grid>
              <Block title="Bonus rules">
                {rules.length === 0 ? (
                  <Card>
                    <EmptyState icon={Award} title="No bonus rules right now" message="When HOMEEIGO runs a bonus, the rule and your progress appear here." testID="incentives-empty" />
                  </Card>
                ) : (
                  rules.map((r) => {
                    const status = r.paid ? "Paid" : r.eligible ? "Qualified" : "In progress";
                    return (
                      <Card key={r.id}>
                        <KeyValue label={r.name} value={rupees(r.paid ? (r.payoutAmount ?? r.bonusAmount) : r.bonusAmount)} strong />
                        <T kind="small" numeric>{`${r.current} of ${r.threshold} ${humanise(r.metric).toLowerCase()} · ${humanise(r.period)}`}</T>
                        <Pill label={status} tone={r.paid ? "success" : r.eligible ? "leaf" : "neutral"} />
                        <ProgressRow label="Progress" pct={r.progressPct} />
                      </Card>
                    );
                  })
                )}
              </Block>
              {paid.length > 0 ? (
                <Block title="Bonuses paid" caption="Bonuses are credited to your wallet balance.">
                  <Card>
                    {paid.map((p, i) => (
                      <ListRow
                        key={p.id}
                        icon={Award}
                        tone="warning"
                        title={p.rule?.name ?? humanise(p.periodKey)}
                        subtitle={`${humanise(p.status)} · ${formatDay(p.createdAt)}`}
                        value={rupees(p.amount)}
                        last={i === paid.length - 1}
                      />
                    ))}
                  </Card>
                </Block>
              ) : null}
            </>
          );
        }}
      </Loadable>
    </HqScreen>
  );
}

export function EarningsTaxScreen() {
  const tax = useTaxSummaryQuery();
  return (
    <HqScreen title="Tax summary" subtitle="All-time totals from your earnings." refresh={[K.tax]}>
      <Loadable query={tax} errorTitle="Could not load your tax summary" loadingLabel="Loading your tax summary…">
        {(t) => (
          <>
            <Banner
              tone="info"
              title="These are all-time totals"
              message={`The server adds up every earning credited to you since you joined. It labels the result ${t.financialYear}, but the figures are not limited to that year.`}
              testID="tax-all-time-notice"
            />
            <Card>
              <KeyValue label="Gross earnings, all time" value={rupees(t.grossEarnings)} />
              <KeyValue label="Platform commission, all time" value={rupees(t.platformCommission)} />
              <KeyValue label="Net earnings, all time" value={rupees(t.netEarnings)} strong />
              <KeyValue label="Paid to your bank (completed withdrawals)" value={rupees(t.settledOut)} />
            </Card>
            <Block title="Estimates" caption="These are the server's rough estimates at fixed rates, not a tax computation or a certificate. Check with a tax adviser before you file.">
              <Card>
                <KeyValue label="GST on commission (estimate)" value={rupees(t.gstOnCommission)} />
                <KeyValue label="Tax / TDS on net earnings (estimate)" value={rupees(t.estimatedTax)} />
              </Card>
            </Block>
          </>
        )}
      </Loadable>
    </HqScreen>
  );
}

/**
 * `GET /api/providers/me/forecast`. Only the figure for today is an estimate; the "weekly" and
 * "monthly" fields are what was actually earned in the last 7 and 30 days, and are labelled so.
 */
export function EarningsForecastScreen() {
  const forecast = useForecastQuery();
  return (
    <HqScreen title="Earnings outlook" subtitle="An estimate for today, and what you actually earned recently." refresh={[K.forecast]}>
      <Loadable query={forecast} errorTitle="Could not load your earnings outlook" loadingLabel="Loading your earnings outlook…">
        {(f) => {
          const today = f.basis?.todayProjection;
          const week = f.basis?.weeklyProjection;
          const month = f.basis?.monthlyProjection;
          const sure = confidencePercent(today?.confidence);
          return (
            <>
              <Block title="Today" caption="The server's estimate is the larger of what you have earned today and expected demand priced at your average net earning per job. It is not a promise.">
                <Card testID="forecast-today">
                  <KeyValue label="Estimate for today" value={rupees(f.todayProjection)} strong />
                  <KeyValue label="Earned so far today" value={rupees(f.inputs?.todayEarnings)} />
                  <KeyValue label="Average per job (net)" value={rupees(f.inputs?.avgPerJob)} />
                  <KeyValue label="Confidence" value={sure ?? "Not stated"} />
                </Card>
              </Block>
              <Block title="What you earned" caption="Actual net earnings, not predictions. No growth is assumed.">
                <Card testID="forecast-actuals">
                  <KeyValue label="Last 7 days" value={week?.state === "INSUFFICIENT_HISTORY" ? "Not enough history" : rupees(f.weeklyProjection)} />
                  <KeyValue label="Last 30 days" value={month?.state === "INSUFFICIENT_HISTORY" ? "Not enough history" : rupees(f.monthlyProjection)} />
                </Card>
              </Block>
            </>
          );
        }}
      </Loadable>
    </HqScreen>
  );
}
