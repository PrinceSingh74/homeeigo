
import React from "react";
import { ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/hooks/useTheme";
import { startupMark } from "@/lib/startup-trace";
import { Navbar } from "@/components/Navbar";
import { HomeBackground } from "@/components/HomeBackground";
import { HeroSection } from "@/components/HeroSection";
import { SearchBar } from "@/components/SearchBar";
import { ServiceCategories } from "@/components/ServiceCategories";
import { ExploreCategories } from "@/components/ExploreCategories";
import { HomeReviews } from "@/components/HomeReviews";
import { AccountSummaryStrip } from "@/components/AccountSummaryStrip";
import { FeatureBanner } from "@/components/FeatureBanner";
import { OffersSection } from "@/components/OffersSection";
import { TrustSection } from "@/components/TrustSection";
import { PremiumSection } from "@/components/PremiumSection";
import { LiveTrackingSection } from "@/components/LiveTrackingSection";
import { FinalCtaSection } from "@/components/FinalCtaSection";
import { HomeFooter } from "@/components/HomeFooter";

export default function HomeScreen() {
  const { colors: themeColors, isDark } = useTheme();

  React.useEffect(() => {
    startupMark("HOME_RENDER");
  }, []);

  return (
    <SafeAreaView
      edges={["top"]}
      style={[styles.container, { backgroundColor: isDark ? themeColors.bg : "#ffffff" }]}
    >
      {/* World-class mint canvas — same as the Homeeigo website home page. */}
      <HomeBackground />
      <Navbar />
      <ScrollView
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        contentContainerStyle={styles.scroll}
      >
        {/* Section order mirrors the Homeeigo website home page. */}
        <HeroSection />
        <SearchBar />
        <ServiceCategories />
        <ExploreCategories />
        <HomeReviews />
        <AccountSummaryStrip />
        <FeatureBanner />
        <OffersSection />
        <TrustSection />
        <PremiumSection />
        <LiveTrackingSection />
        <FinalCtaSection />
        <HomeFooter />
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
