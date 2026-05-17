import React from "react";
import { ScrollView, View, StyleSheet, SafeAreaView } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { HeroSection } from "@/components/HeroSection";
import { SearchBar } from "@/components/SearchBar";
import { ServiceCategories } from "@/components/ServiceCategories";

export default function HomeScreen() {
  const { colors: themeColors, isDark } = useTheme();

  return (
    <SafeAreaView
      style={[
        styles.container,
        { backgroundColor: themeColors.bg },
      ]}
    >
      <ScrollView
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
      >
        <HeroSection />
        <SearchBar />
        <ServiceCategories />
        <View style={{ height: 100 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
