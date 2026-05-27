import React from "react";
import { StyleSheet, View, ActivityIndicator } from "react-native";
import Animated from "react-native-reanimated";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAnimatedScroll } from "@/hooks/useAnimatedScroll";
import { useServicesFonts } from "@/hooks/useServicesFonts";
import { ServicesProvider } from "@/components/services/ServicesContext";
import { ServicesThemeProvider, useServicesTheme } from "@/components/services/ServicesThemeContext";
import { ServicesHeader } from "@/components/services/ServicesHeader";
import { ServicesHeroSection } from "@/components/services/ServicesHeroSection";
import { CategoriesSection } from "@/components/services/CategoriesSection";
import { AIRecommendations } from "@/components/services/AIRecommendations";
import { TrendingServices } from "@/components/services/TrendingServices";
import { ExpressServices } from "@/components/services/ExpressServices";
import { WhyChooseUs } from "@/components/services/WhyChooseUs";
import { PremiumBanner } from "@/components/services/PremiumBanner";
import { CustomerReviews } from "@/components/services/CustomerReviews";
import { CTABanner } from "@/components/services/CTABanner";
import { SectionShell } from "@/components/services/common/SectionShell";
import { ServicesAmbientBg } from "@/components/services/visual/ServicesAmbientBg";

function ServicesScreenContent() {
  const { scrollY, scrollHandler } = useAnimatedScroll();
  const { c, layout: L } = useServicesTheme();

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      <ServicesAmbientBg />
      <ServicesHeader scrollY={scrollY} />
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={scrollHandler}
        contentContainerStyle={[styles.scroll, { paddingBottom: L.scrollBottom }]}
      >
        <ServicesHeroSection scrollY={scrollY} />

        <SectionShell gap="tight">
          <CategoriesSection />
        </SectionShell>

        <SectionShell>
          <AIRecommendations />
        </SectionShell>

        <SectionShell>
          <TrendingServices />
        </SectionShell>

        <SectionShell>
          <ExpressServices />
        </SectionShell>

        <SectionShell>
          <WhyChooseUs />
        </SectionShell>

        <SectionShell>
          <PremiumBanner />
        </SectionShell>

        <SectionShell>
          <CustomerReviews />
        </SectionShell>

        <SectionShell gap="tight">
          <CTABanner />
        </SectionShell>
      </Animated.ScrollView>
    </View>
  );
}

function ServicesScreenInner() {
  const fontsLoaded = useServicesFonts();
  const { c, layout: L } = useServicesTheme();

  if (!fontsLoaded) {
    return (
      <SafeAreaView style={[styles.loading, { backgroundColor: c.background }]}>
        <ActivityIndicator size="large" color={c.primary} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: c.background }]} edges={["bottom"]}>
      <ServicesProvider>
        <ServicesScreenContent />
      </ServicesProvider>
    </SafeAreaView>
  );
}

export function ServicesScreen() {
  return (
    <ServicesThemeProvider>
      <ServicesScreenInner />
    </ServicesThemeProvider>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  root: { flex: 1 },
  scroll: {},
});
