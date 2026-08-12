// Services tab. Implemented here like every other tab route — it previously lived
// alone in src/screens/, a directory that existed for this one file.
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
import { ExpressServices } from "@/components/services/ExpressServices";
import { WhyChooseUs } from "@/components/services/WhyChooseUs";
import { PremiumBanner } from "@/components/services/PremiumBanner";
import { CustomerReviews } from "@/components/services/CustomerReviews";
import { TransparentPricing } from "@/components/services/TransparentPricing";
import { CitiesSection } from "@/components/services/CitiesSection";
import { HowItWorks } from "@/components/services/HowItWorks";
import {
  HomeCareSection,
  PremiumCareSection,
  LaundrySection,
  OutdoorSection,
  ComingSoonSection,
} from "@/components/services/CategorySections";
import { CTABanner } from "@/components/services/CTABanner";
import { HomeFooter } from "@/components/HomeFooter";
import { SectionShell } from "@/components/services/common/SectionShell";
import { ServicesAmbientBg } from "@/components/services/visual/ServicesAmbientBg";
import { TrustStrip } from "@/components/services/TrustStrip";
import { SocialProofStrip } from "@/components/services/SocialProofStrip";
import { StickyBookingBar, STICKY_BAR_H } from "@/components/services/StickyBookingBar";

function ServicesScreenContent() {
  const { scrollY, scrollHandler } = useAnimatedScroll();
  const { c, layout: L } = useServicesTheme();

  return (
    <View style={[styles.root, { backgroundColor: c.background }]}>
      <ServicesAmbientBg />
      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={scrollHandler}
        contentContainerStyle={[styles.scroll, { paddingBottom: L.scrollBottom + STICKY_BAR_H }]}
      >
        <ServicesHeroSection scrollY={scrollY} />

        {/* CRO: trust lands inside the first 10 seconds, right after the hero. */}
        <SectionShell gap="tight">
          <TrustStrip />
        </SectionShell>

        {/* CRO: live aggregate proof (backend-driven; hides when unavailable). */}
        <SectionShell gap="tight">
          <SocialProofStrip />
        </SectionShell>

        {/* Category quick-nav chips (services hero aid). */}
        <SectionShell gap="tight">
          <CategoriesSection />
        </SectionShell>

        {/* ---- Website services-page order, hero → footer (1:1 parity) ---- */}
        <SectionShell>
          <HomeCareSection />
        </SectionShell>

        <SectionShell>
          <PremiumCareSection />
        </SectionShell>

        <SectionShell>
          <LaundrySection />
        </SectionShell>

        <SectionShell>
          <OutdoorSection />
        </SectionShell>

        <SectionShell>
          <ExpressServices />
        </SectionShell>

        <SectionShell>
          <TransparentPricing />
        </SectionShell>

        <SectionShell>
          <CustomerReviews />
        </SectionShell>

        <SectionShell>
          <WhyChooseUs />
        </SectionShell>

        <SectionShell>
          <CitiesSection />
        </SectionShell>

        <SectionShell>
          <HowItWorks />
        </SectionShell>

        {/* CRO: moved below the conversion-critical sections — unavailable services
            must not create a dead-end while intent is still forming. */}
        <SectionShell>
          <ComingSoonSection />
        </SectionShell>

        <SectionShell>
          <PremiumBanner />
        </SectionShell>

        {/* AI scheduling nudge (= website AiSchedulingSection). */}
        <SectionShell>
          <AIRecommendations />
        </SectionShell>

        <SectionShell gap="tight">
          <CTABanner />
        </SectionShell>

        {/* Footer — closes the page like the website services footer. */}
        <HomeFooter />
      </Animated.ScrollView>

      {/* Immersive navbar — floats over the full-bleed hero image. */}
      <ServicesHeader scrollY={scrollY} />

      {/* CRO: persistent booking CTA in the thumb zone, revealed after first scroll. */}
      <StickyBookingBar scrollY={scrollY} />
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

export default function ServicesScreen() {
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
