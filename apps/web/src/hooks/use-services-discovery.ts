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
import { useFeaturedServicesQuery, useProvidersQuery, useServicesQuery } from "@/hooks/use-core-data";

const iconMap: Record<string, LucideIcon> = {
  cleaning: SprayCan,
  "ac-service": AirVent,
  plumbing: Droplets,
  electrician: Zap,
  "pest-control": Bug,
  salon: Scissors,
};

const fallbackIcon = Wrench;

export function useServicesDiscovery() {
  const servicesQuery = useServicesQuery();
  const featuredQuery = useFeaturedServicesQuery();
  const firstFeaturedService = featuredQuery.data?.services?.[0]?.id ?? servicesQuery.data?.services?.[0]?.id ?? "";
  const providersQuery = useProvidersQuery(firstFeaturedService);

  const categories = useMemo(() => {
    const services = servicesQuery.data?.services ?? [];
    return services.slice(0, 9).map((s, i) => {
      const icon = iconMap[s.id] ?? fallbackIcon;
      const palette = ["#EDE9FE", "#CFFAFE", "#DBEAFE", "#FFEDD5", "#DCFCE7", "#F3E8FF"][i % 6]!;
      const iconColor = ["#7C3AED", "#0891B2", "#2563EB", "#EA580C", "#16A34A", "#9333EA"][i % 6]!;
      return {
        id: s.id,
        name: s.name,
        count: s.bookingCount ?? s.reviewCount ?? 0,
        serviceId: s.id,
        icon,
        iconColor,
        iconBg: palette,
        image: s.thumbnail ?? s.icon ?? "https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=1200&q=90&auto=format&fit=crop",
      };
    });
  }, [servicesQuery.data?.services]);

  const trending = useMemo(() => {
    const services = (featuredQuery.data?.services ?? servicesQuery.data?.services ?? []).slice(0, 6);
    const providers = providersQuery.data?.providers ?? [];
    return services.map((s, i) => ({
      id: s.id,
      title: s.name,
      provider: providers[i]?.name ?? "HOMEEIGO Pro",
      providerAvatar:
        providers[i]?.profileImage ??
        "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&q=90&auto=format&fit=crop",
      // Real rating: prefer the provider's maintained avg, else the service's
      // aggregated rating. 0/absent means no reviews yet → null ("New").
      rating: ((): number | null => {
        const r = providers[i]?.rating || s.rating || 0;
        return r > 0 ? Number(r.toFixed(1)) : null;
      })(),
      reviews: s.reviewCount ?? providers[i]?.reviewCount ?? 0,
      price: s.basePrice ?? s.minPrice ?? 0,
      duration: "60-120 mins",
      type: s.category ? `${s.category}` : "Premium",
      image:
        s.thumbnail ??
        s.icon ??
        "https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=1200&q=90&auto=format&fit=crop",
      serviceId: s.id,
    }));
  }, [featuredQuery.data?.services, providersQuery.data?.providers, servicesQuery.data?.services]);

  const aiRecommendations = useMemo(() => {
    return (featuredQuery.data?.services ?? servicesQuery.data?.services ?? []).slice(0, 4).map((s, i) => ({
      id: `ai-${s.id}`,
      title: `${s.name} Recommended`,
      description:
        s.description ??
        `Popular ${s.name.toLowerCase()} service with verified professionals in your city.`,
      badge: (i % 3 === 0 ? "AI Recommended" : i % 3 === 1 ? "Popular" : "Urgent") as
        | "AI Recommended"
        | "Popular"
        | "Urgent",
      serviceId: s.id,
      gradient: "from-blue-500/15 to-violet-500/10",
      icon: iconMap[s.id] ?? fallbackIcon,
    }));
  }, [featuredQuery.data?.services, servicesQuery.data?.services]);

  return {
    categories,
    trending,
    aiRecommendations,
    isLoading: servicesQuery.isLoading || featuredQuery.isLoading,
    isError: servicesQuery.isError || featuredQuery.isError,
    retry: () => {
      void servicesQuery.refetch();
      void featuredQuery.refetch();
    },
  };
}
