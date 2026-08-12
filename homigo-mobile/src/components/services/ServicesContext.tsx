import React, { createContext, useContext, useMemo, useState } from "react";
import { filterTrendingServices } from "@/lib/services-search";
import type { TrendingService } from "@/constants/servicesData";
import { useServicesDiscovery } from "@/hooks/use-services-discovery";

type ServicesContextValue = {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  activeCategoryId: number | null;
  setActiveCategoryId: (id: number | null) => void;
  activePopularSearch: string | null;
  setActivePopularSearch: (s: string | null) => void;
  filteredTrending: TrendingService[];
  isFromApi: boolean;
};

const ServicesContext = createContext<ServicesContextValue | null>(null);

export function ServicesProvider({ children }: { children: React.ReactNode }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategoryId, setActiveCategoryId] = useState<number | null>(null);
  const [activePopularSearch, setActivePopularSearch] = useState<string | null>(null);
  const { trending, isLoading, isFromApi } = useServicesDiscovery();

  const filteredTrending = useMemo(
    () => filterTrendingServices(trending, searchQuery, activeCategoryId, activePopularSearch),
    [trending, searchQuery, activeCategoryId, activePopularSearch],
  );

  const value = useMemo(
    () => ({
      searchQuery,
      setSearchQuery,
      activeCategoryId,
      setActiveCategoryId,
      activePopularSearch,
      setActivePopularSearch,
      filteredTrending,
      isFromApi: isFromApi && !isLoading,
    }),
    [
      searchQuery,
      activeCategoryId,
      activePopularSearch,
      filteredTrending,
      isFromApi,
      isLoading,
    ],
  );

  return <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>;
}

export function useServicesContext() {
  const ctx = useContext(ServicesContext);
  if (!ctx) {
    throw new Error("useServicesContext must be used within ServicesProvider");
  }
  return ctx;
}
