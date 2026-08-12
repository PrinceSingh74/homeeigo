"use client";

import dynamic from "next/dynamic";

const RoutePrefetch = dynamic(
  () => import("@/components/navigation/RoutePrefetch").then((m) => ({ default: m.RoutePrefetch })),
  { ssr: false },
);

export function LazyRoutePrefetch() {
  return <RoutePrefetch />;
}
