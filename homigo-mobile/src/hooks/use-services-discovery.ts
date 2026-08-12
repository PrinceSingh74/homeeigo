import { useMemo } from "react";
import { useFeaturedServicesQuery, useProvidersQuery, useServicesQuery } from "@/hooks/use-core-data";

const CATEGORY_EMOJI: Record<string, string> = {
  cleaning: "🧹",
  "ac-service": "❄️",
  plumbing: "🔧",
  electrician: "⚡",
  "pest-control": "🐛",
  salon: "💜",
  painting: "🎨",
};

const CATEGORY_BG: Record<number, string> = {
  0: "#EEF2FF",
  1: "#E0F2FE",
  2: "#DBEAFE",
  3: "#FFF9C4",
  4: "#F0FFF4",
  5: "#FDF4FF",
  6: "#FFF7ED",
  7: "#FEF3C7",
  8: "#F0F4FF",
};

function emojiForService(id: string, name: string): string {
  const key = id.toLowerCase();
  for (const [k, emoji] of Object.entries(CATEGORY_EMOJI)) {
    if (key.includes(k) || name.toLowerCase().includes(k.replace("-", " "))) return emoji;
  }
  return "🏠";
}

export function useServicesDiscovery(enabled = true) {
  const servicesQuery = useServicesQuery({ enabled });
  const featuredQuery = useFeaturedServicesQuery({ enabled });
  const firstFeaturedService =
    featuredQuery.data?.services?.[0]?.id ?? servicesQuery.data?.services?.[0]?.id ?? "";
  const providersQuery = useProvidersQuery(firstFeaturedService, { enabled: enabled && !!firstFeaturedService });

  const categories = useMemo(() => {
    const services = servicesQuery.data?.services ?? [];
    return services.slice(0, 9).map((s, i) => ({
      id: i + 1,
      name: s.name,
      count: s.bookingCount ?? s.reviewCount ?? 0,
      emoji: emojiForService(s.id, s.name),
      bgColor: CATEGORY_BG[i % 9] ?? "#EEF2FF",
      serviceId: s.id,
    }));
  }, [servicesQuery.data?.services]);

  const trending = useMemo(() => {
    const services = (featuredQuery.data?.services ?? servicesQuery.data?.services ?? []).slice(0, 6);
    const providers = providersQuery.data?.providers ?? [];
    return services.map((s, i) => ({
      id: i + 1,
      title: s.name,
      // Real rating: prefer the provider's maintained avg, else the service's
      // aggregated rating. 0/absent means no reviews yet → null ("New").
      rating: (() => {
        const r = providers[i]?.rating || s.rating || 0;
        return r > 0 ? Number(r.toFixed(1)) : null;
      })(),
      reviews:
        (s.reviewCount ?? 0) >= 1000
          ? `${((s.reviewCount ?? 0) / 1000).toFixed(1)}k`
          : String(s.reviewCount ?? providers[i]?.reviewCount ?? 0),
      price: s.basePrice ?? s.minPrice ?? 199,
      duration: "60-120 mins",
      imageUri:
        s.thumbnail ??
        s.icon ??
        "https://images.unsplash.com/photo-1581578731548-c64695cc6952?w=1200&q=90&auto=format&fit=crop",
      serviceId: s.id,
      categoryIds: [i + 1],
    }));
  }, [featuredQuery.data?.services, providersQuery.data?.providers, servicesQuery.data?.services]);

  const aiRecommendations = useMemo(() => {
    return (featuredQuery.data?.services ?? servicesQuery.data?.services ?? []).slice(0, 4).map((s, i) => ({
      id: i + 1,
      title: `${s.name} Recommended`,
      desc:
        s.description ??
        `Popular ${s.name.toLowerCase()} service with verified professionals in your city.`,
      emoji: emojiForService(s.id, s.name),
      bgFrom: ["#EDE9FE", "#CFFAFE", "#DBEAFE", "#FFEDD5"][i % 4]!,
      bgTo: ["#DDD6FE", "#A5F3FC", "#BFDBFE", "#FED7AA"][i % 4]!,
      urgent: i === 2,
      serviceId: s.id,
    }));
  }, [featuredQuery.data?.services, servicesQuery.data?.services]);

  const expressServices = useMemo(() => {
    return (featuredQuery.data?.services ?? servicesQuery.data?.services ?? []).slice(0, 4).map((s, i) => ({
      icon: emojiForService(s.id, s.name),
      name: s.name,
      price: s.basePrice ?? s.minPrice ?? 199,
      iconBg: ["#EDE9FE", "#CFFAFE", "#DBEAFE", "#FFEDD5"][i % 4]!,
      iconColor: ["#7C3AED", "#0891B2", "#2563EB", "#EA580C"][i % 4]!,
      serviceId: s.id,
    }));
  }, [featuredQuery.data?.services, servicesQuery.data?.services]);

  return {
    categories,
    trending,
    aiRecommendations,
    expressServices,
    isLoading: servicesQuery.isLoading || featuredQuery.isLoading,
    isFromApi: Boolean(servicesQuery.data?.services?.length),
  };
}
