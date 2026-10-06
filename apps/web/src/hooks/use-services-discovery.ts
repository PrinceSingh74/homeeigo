"use client";

import { useMemo } from "react";
import {
  AirVent,
  Bug,
  Droplets,
  Scissors,
  SprayCan,
  Wrench,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { useFeaturedServicesQuery, useServicesQuery } from "@/hooks/use-core-data";

const iconMap: Record<string, LucideIcon> = {
  cleaning: SprayCan,
  "ac-service": AirVent,
  plumbing: Droplets,
  electrician: Zap,
  "pest-control": Bug,
  salon: Scissors,
};

const fallbackIcon = Wrench;

/**
 * Suggested services for the catalogue modal: the catalogue's featured services, each shown with
 * its OWN server fields only.
 *
 * Removed with their last consumer: a "trending" list that paired service i with provider i by list
 * position (so a service showed an unrelated professional's name, face and rating), fell back to a
 * stand-in professional and a stock portrait, and gave every service the same fixed duration; and a
 * "categories" list that showed a booking or review count as a number of services.
 */
export function useServicesDiscovery() {
  const servicesQuery = useServicesQuery();
  const featuredQuery = useFeaturedServicesQuery();

  const aiRecommendations = useMemo(() => {
    return (featuredQuery.data?.services ?? servicesQuery.data?.services ?? []).slice(0, 4).map((s) => ({
      id: `ai-${s.id}`,
      // The service as the catalogue describes it. The title used to append "Recommended", the
      // description fell back to an invented sentence, and the badge ("AI Recommended" / "Popular" /
      // "Urgent") was chosen by list position.
      title: s.name,
      description: s.description ?? "",
      badge: (s.isFeatured ? "Featured" : s.isPopular ? "Popular" : null) as "Featured" | "Popular" | null,
      serviceId: s.id,
      gradient: "from-blue-500/15 to-violet-500/10",
      icon: iconMap[s.id] ?? fallbackIcon,
    }));
  }, [featuredQuery.data?.services, servicesQuery.data?.services]);

  return {
    aiRecommendations,
    isLoading: servicesQuery.isLoading || featuredQuery.isLoading,
    isError: servicesQuery.isError || featuredQuery.isError,
    retry: () => {
      void servicesQuery.refetch();
      void featuredQuery.refetch();
    },
  };
}
