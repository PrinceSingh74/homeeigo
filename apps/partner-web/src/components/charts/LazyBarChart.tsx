"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";

const BarChartInner = dynamic(
  () => import("./BarChartInner").then((m) => m.BarChartInner),
  {
    ssr: false,
    loading: () => (
      <div className="h-full w-full rounded-lg bg-white/[0.03]" aria-hidden />
    ),
  },
);

export type LazyBarChartProps = ComponentProps<typeof BarChartInner>;

export function LazyBarChart(props: LazyBarChartProps) {
  return <BarChartInner {...props} />;
}
