import { colors } from "@/lib/colors";
import { useResolvedIsDark, useThemeStore } from "@/lib/theme-store";

export const useTheme = () => {
  const isDark = useResolvedIsDark();
  const preference = useThemeStore((s) => s.preference);
  const currentColors = isDark ? colors.dark : colors.light;

  return {
    isDark,
    colors: currentColors,
    colorScheme: isDark ? "dark" : "light",
    preference,
  };
};
