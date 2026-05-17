import { useColorScheme } from "react-native";
import { colors } from "@/lib/colors";

export const useTheme = () => {
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const currentColors = isDark ? colors.dark : colors.light;

  return {
    isDark,
    colors: currentColors,
    colorScheme: scheme,
  };
};
