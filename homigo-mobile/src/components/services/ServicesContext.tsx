import React, { createContext, useContext, useMemo, useState } from "react";
import { TRENDING_SERVICES } from "@/constants/servicesData";
import type { TrendingService } from "@/constants/servicesData";
import { filterTrendingServices } from "@/lib/services-search";

type ServicesContextValue = {
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  activeCategoryId: number | null;
  setActiveCategoryId: (id: number | null) => void;
  activePopularSearch: string | null;
  setActivePopularSearch: (s: string | null) => void;
  filteredTrending: TrendingService[];
};

const ServicesContext = createContext<ServicesContextValue | null>(null);

export function ServicesProvider({ children }: { children: React.ReactNode }) {
  const [searchQuery, setSearchQuery] = useState("");
  const [activeCategoryId, setActiveCategoryId] = useState<number | null>(null);
  const [activePopularSearch, setActivePopularSearch] = useState<string | null>(
    null,
  );

  const filteredTrending = useMemo(
    () =>
      filterTrendingServices(
        TRENDING_SERVICES,
        searchQuery,
        activeCategoryId,
        activePopularSearch,
      ),
    [searchQuery, activeCategoryId, activePopularSearch],
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
    }),
    [
      searchQuery,
      activeCategoryId,
      activePopularSearch,
      filteredTrending,
    ],
  );

  return (
    <ServicesContext.Provider value={value}>{children}</ServicesContext.Provider>
  );
}

export function useServicesContext() {
  const ctx = useContext(ServicesContext);
  if (!ctx) {
    throw new Error("useServicesContext must be used within ServicesProvider");
  }
  return ctx;
}
