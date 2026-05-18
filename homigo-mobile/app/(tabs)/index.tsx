import React from "react";
import { ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/useTheme";
import { Navbar } from "@/components/Navbar";
import { HeroSection } from "@/components/HeroSection";
import { SearchBar } from "@/components/SearchBar";
import { ServiceCategories } from "@/components/ServiceCategories";
import { FeatureBanner } from "@/components/FeatureBanner";
import { OffersSection } from "@/components/OffersSection";
import { RecommendedSection } from "@/components/RecommendedSection";
import { TrustSection } from "@/components/TrustSection";
import { PremiumSection } from "@/components/PremiumSection";
import { LiveTrackingSection } from "@/components/LiveTrackingSection";
import { FinalCtaSection } from "@/components/FinalCtaSection";

export default function HomeScreen() {
  const { colors: themeColors } = useTheme();

  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.container, { backgroundColor: themeColors.bg }]}
    >
      <Navbar />
      <ScrollView
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        contentContainerStyle={styles.scroll}
      >
        <HeroSection />
        <SearchBar />
        <ServiceCategories />
        <FeatureBanner />
        <OffersSection />
        <RecommendedSection />
        <TrustSection />
        <PremiumSection />
        <LiveTrackingSection />
        <FinalCtaSection />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scroll: {
    paddingTop: 4,
  },
});
