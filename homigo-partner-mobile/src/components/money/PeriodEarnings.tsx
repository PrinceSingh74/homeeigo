import { TrendingUp } from "lucide-react-native";
import { useMemo, useState } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import Svg, { Line, Rect } from "react-native-svg";
import { Block, Loadable } from "@/components/money/DataScreen";
import { Card, EmptyState, KeyValue, T } from "@/components/ui";
import { useEarningsQuery } from "@/hooks/money/queries";
import { count, formatCalendarDay, rupees } from "@/lib/money-format";
import { earningsChart, type SeriesPoint } from "@/lib/money-series";
import { color, radius, space, touch } from "@/theme/tokens";
import type { PartnerEarningsSummary } from "@/types/partner";

export const EARNING_PERIODS = [7, 30, 90] as const;
export type EarningPeriod = (typeof EARNING_PERIODS)[number];

const CHART_HEIGHT = 132;

/**
 * Net earnings per day, drawn from the server's `series` (one entry per UTC day, zero-filled).
 * The axis top is the largest day in that series; nothing is smoothed, averaged or projected.
 */
export function EarningsBarChart({ series }: { series: SeriesPoint[] }) {
  const [width, setWidth] = useState(0);
  const chart = useMemo(() => earningsChart(series), [series]);
  const first = chart.bars[0]?.date;
  const last = chart.bars[chart.bars.length - 1]?.date;
  const n = chart.bars.length;
  const gap = n > 45 ? 1 : n > 14 ? 2 : 6;
  const barWidth = n > 0 && width > 0 ? Math.max(1, (width - gap * (n - 1)) / n) : 0;

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Net earnings per day${first && last ? `, ${formatCalendarDay(first, true)} to ${formatCalendarDay(last, true)}` : ""}. The tallest bar is ${rupees(chart.max)}.`}
      testID="earnings-chart"
    >
      <T kind="caption" numeric>
        {rupees(chart.max)}
      </T>
      <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)} style={styles.chart}>
        {width > 0 ? (
          <Svg width={width} height={CHART_HEIGHT}>
            <Line x1={0} y1={0.5} x2={width} y2={0.5} stroke={color.line} strokeWidth={1} strokeDasharray="3 4" />
            <Line x1={0} y1={CHART_HEIGHT - 0.5} x2={width} y2={CHART_HEIGHT - 0.5} stroke={color.line} strokeWidth={1} />
            {chart.bars.map((b, i) => {
              const h = b.ratio > 0 ? Math.max(2, b.ratio * (CHART_HEIGHT - 2)) : 0;
              return h > 0 ? <Rect key={b.date} x={i * (barWidth + gap)} y={CHART_HEIGHT - 1 - h} width={barWidth} height={h} rx={Math.min(3, barWidth / 2)} fill={color.leaf} /> : null;
            })}
          </Svg>
        ) : null}
      </View>
      <View style={styles.axis}>
        <T kind="caption" numeric>
          {first ? formatCalendarDay(first) : ""}
        </T>
        <T kind="caption" numeric>
          {last ? formatCalendarDay(last) : ""}
        </T>
      </View>
    </View>
  );
}

/** The period's figures exactly as `GET /api/providers/me/earnings` names them, and the daily chart. */
export function PeriodSummary({ earnings }: { earnings: PartnerEarningsSummary }) {
  const hasEarnings = useMemo(() => earningsChart(earnings.series).hasEarnings, [earnings.series]);
  return (
    <>
      <Card testID="period-earnings-summary">
        <KeyValue label="Net" value={rupees(earnings.totalNet)} strong testID="period-net" />
        <KeyValue label="Gross" value={rupees(earnings.totalGross)} />
        <KeyValue label="Platform commission" value={rupees(earnings.totalCommission)} />
        <KeyValue label="Jobs" value={count(earnings.totalJobs)} />
        <KeyValue label="Average per job (gross)" value={rupees(earnings.averagePerJob)} />
        <KeyValue label="Average per job (net)" value={rupees(earnings.averageNetPerJob)} />
        <T kind="small" style={styles.note}>
          Only earnings credited to you are counted. Amounts are whole rupees, as the server rounds them.
        </T>
      </Card>
      <Card>
        <T kind="smallStrong" tone="slate" accessibilityRole="header" style={styles.chartTitle}>
          Net earnings per day
        </T>
        {hasEarnings ? (
          <>
            <EarningsBarChart series={earnings.series} />
            <T kind="small" style={styles.note}>
              Each bar is one day (days are counted in UTC, so a late-evening job can fall on the next bar).
            </T>
          </>
        ) : (
          <EmptyState icon={TrendingUp} title="No earnings in this period" message="Completed, paid jobs will show here day by day." testID="period-earnings-empty" />
        )}
      </Card>
    </>
  );
}

export function PeriodPicker({ value, onChange }: { value: EarningPeriod; onChange: (days: EarningPeriod) => void }) {
  return (
    <View style={styles.picker} accessibilityRole="radiogroup" accessibilityLabel="Period">
      {EARNING_PERIODS.map((days) => {
        const selected = days === value;
        return (
          <Pressable
            key={days}
            testID={`period-${days}`}
            onPress={() => onChange(days)}
            accessibilityRole="radio"
            accessibilityLabel={`Last ${days} days`}
            accessibilityState={{ selected, checked: selected }}
            style={({ pressed }) => [styles.pick, selected ? styles.pickOn : null, pressed && !selected ? styles.pickPressed : null]}
          >
            <T kind="bodyStrong" tone={selected ? "onLeaf" : "leaf"} numeric>{`${days} days`}</T>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Period earnings with its own period choice; the heading is the server's own label ("Last 30 days"). */
export function PeriodEarnings({ initialDays = 30 }: { initialDays?: EarningPeriod }) {
  const [days, setDays] = useState<EarningPeriod>(initialDays);
  const earnings = useEarningsQuery(days);
  return (
    <Block title={earnings.data?.period ?? `Last ${days} days`}>
      <PeriodPicker value={days} onChange={setDays} />
      <Loadable query={earnings} errorTitle="Could not load earnings" loadingLabel="Loading earnings…">
        {(e) => <PeriodSummary earnings={e} />}
      </Loadable>
    </Block>
  );
}

const styles = StyleSheet.create({
  chart: { height: CHART_HEIGHT, marginTop: space.xs },
  axis: { flexDirection: "row", justifyContent: "space-between", marginTop: space.xs },
  chartTitle: { marginBottom: space.sm },
  note: { marginTop: space.sm },
  picker: { flexDirection: "row", gap: space.sm },
  pick: { flex: 1, minHeight: touch.min, borderRadius: radius.control, borderWidth: 1, borderColor: color.line, backgroundColor: color.surface, alignItems: "center", justifyContent: "center", paddingHorizontal: space.sm },
  pickOn: { backgroundColor: color.leaf, borderColor: color.leaf },
  pickPressed: { backgroundColor: color.well },
});
