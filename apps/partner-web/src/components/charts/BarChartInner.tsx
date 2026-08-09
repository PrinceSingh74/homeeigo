"use client";

import { memo, useMemo } from "react";
import {
  Bar,
  BarChart,
  ResponsiveContainer,
  XAxis,
  YAxis,
  Cell,
} from "recharts";

export type BarChartDatum = { day: string; amount: number };

export const BarChartInner = memo(function BarChartInner({
  data,
  max,
  colors,
}: {
  data: BarChartDatum[];
  max: number;
  colors: string[];
}) {
  const axisConfig = useMemo(
    () => ({
      axisLine: false as const,
      tickLine: false as const,
      tick: { fill: "#94a3b8", fontSize: 11 },
      dy: 4,
    }),
    [],
  );

  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart
        data={data}
        margin={{ top: 4, right: 4, left: -24, bottom: 0 }}
        barCategoryGap="18%"
      >
        <XAxis dataKey="day" {...axisConfig} />
        <YAxis hide domain={[0, max * 1.12]} />
        <Bar dataKey="amount" radius={[6, 6, 0, 0]} maxBarSize={36} isAnimationActive={false}>
          {data.map((_, i) => (
            <Cell key={i} fill={colors[i % colors.length]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
});
