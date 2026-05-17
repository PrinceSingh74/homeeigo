import React from "react";
import { ScrollView, View, StyleSheet, SafeAreaView } from "react-native";
import { useTheme } from "@/hooks/useTheme";
import { HeroSection } from "@/components/HeroSection";
import { SearchBar } from "@/components/SearchBar";
import { ServiceCategories } from "@/components/ServiceCategories";
import { FeatureBanner } from "@/components/FeatureBanner";
import { OffersSection } from "@/components/OffersSection";

export default function HomeScreen() {
  const { colors: themeColors } = useTheme();

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
        <FeatureBanner />
        <OffersSection />
        <View style={{ height: 40 }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
