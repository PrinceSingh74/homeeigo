import React, { createContext, useContext, useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useResolvedIsDark } from "@/lib/theme-store";
import {
  SERVICES_DARK,
  SERVICES_LIGHT,
  getServicesShadows,
  type ServicesPalette,
} from "@/theme/services-theme";
import {
  computeServicesLayout,
  type ServicesLayoutMetrics,
} from "@/lib/services-layout";

type ServicesThemeValue = {
  isDark: boolean;
  c: ServicesPalette;
  shadows: ReturnType<typeof getServicesShadows>;
  layout: ServicesLayoutMetrics;
};

const ServicesThemeContext = createContext<ServicesThemeValue | null>(null);

export function ServicesThemeProvider({ children }: { children: React.ReactNode }) {
  const isDark = useResolvedIsDark();
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const value = useMemo<ServicesThemeValue>(
    () => ({
      isDark,
      c: isDark ? SERVICES_DARK : SERVICES_LIGHT,
      shadows: getServicesShadows(isDark),
      layout: computeServicesLayout(width, height, insets.bottom),
    }),
    [isDark, width, height, insets.bottom],
  );

  return (
    <ServicesThemeContext.Provider value={value}>
      {children}
    </ServicesThemeContext.Provider>
  );
}

export function useServicesTheme() {
  const ctx = useContext(ServicesThemeContext);
  if (!ctx) {
    throw new Error("useServicesTheme must be used within ServicesThemeProvider");
  }
  return ctx;
}
