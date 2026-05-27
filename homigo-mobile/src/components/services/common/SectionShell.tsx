import React from "react";
import { View, StyleSheet, type ViewStyle } from "react-native";
import { useServicesTheme } from "../ServicesThemeContext";

type Props = {
  children: React.ReactNode;
  gap?: "default" | "tight" | "none";
  style?: ViewStyle;
};

export function SectionShell({ children, gap = "default", style }: Props) {
  const { layout: L } = useServicesTheme();
  const marginTop =
    gap === "none" ? 0 : gap === "tight" ? L.sectionGapTight : L.sectionGap;

  return <View style={[styles.shell, { marginTop }, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  shell: {},
});
