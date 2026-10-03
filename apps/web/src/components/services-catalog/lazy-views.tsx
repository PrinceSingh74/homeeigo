"use client";

import dynamic from "next/dynamic";
import { ServiceSkeleton } from "@/components/services-catalog/ServiceStates";

/**
 * /services/[...path] renders either a category landing or a service detail —
 * never both — so each is its own async chunk. SSR still renders the HTML.
 */
export const CategoryLanding = dynamic(
  () => import("@/components/services-catalog/CategoryLanding").then((m) => m.CategoryLanding),
  { loading: () => <ServiceSkeleton /> },
);

export const ServiceDetail = dynamic(
  () => import("@/components/services-catalog/detail/ServiceDetail").then((m) => m.ServiceDetail),
  { loading: () => <ServiceSkeleton count={4} /> },
);
