import React, { useCallback } from "react";
import { StyleSheet, Platform, StatusBar } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import Animated, { useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { useAppNavigation } from "@/hooks/useAppNavigation";
import { PROFILE_PAD, PROFILE_TAB_SPACER } from "@/lib/profile-layout";
import { ProfileScreenHeader } from "@/components/profile/ProfileScreenHeader";
import { ProfileHeroCard } from "@/components/profile/ProfileHeroCard";
import { ProfilePremiumBanner } from "@/components/profile/ProfilePremiumBanner";
import { ProfileQuickStatsGrid } from "@/components/profile/ProfileQuickStatsGrid";
import { ProfileBookingsSection } from "@/components/profile/ProfileBookingsSection";
import { ProfileInsightsSection } from "@/components/profile/ProfileInsightsSection";
import { ProfileAddressesSection } from "@/components/profile/ProfileAddressesSection";
import { ProfileEmailVerifyCard } from "@/components/profile/ProfileEmailVerifyCard";
import { ProfileReferralCard } from "@/components/profile/ProfileReferralCard";
import { ProfileSessionsSection } from "@/components/profile/ProfileSessionsSection";
import { ProfileHelpLinks } from "@/components/profile/ProfileHelpLinks";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { useBookingsQuery, useAddressesQuery } from "@/hooks/use-core-data";

const BOOKING_SERVICE: Record<string, string> = {
  "p-ac": "ac-service",
  "p-sofa": "cleaning",
};

const INSIGHT_SERVICE: Record<string, string> = {
  ac: "ac-service",
  kitchen: "cleaning",
  savings: "cleaning",
};

export default function ProfileScreen() {
  const { colors: c, isDark } = useTheme();
  const nav = useAppNavigation();
  const scrollY = useSharedValue(0);
  useBookingsQuery();
  useAddressesQuery();

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  const onStatPress = useCallback(
    (id: string, route?: string) => {
      if (route === "wallet" || route === "wallet-coins") {
        nav.goWallet();
        return;
      }
      if (route === "bookings") {
        nav.goBookings();
        return;
      }
      if (id === "addresses") {
        nav.openAddresses();
        return;
      }
      if (id === "referral") {
        nav.openReferral();
        return;
      }
      nav.goWallet();
    },
    [nav],
  );

  return (
    <AuthGuard title="Sign in to view your profile">
    <SafeAreaView
      style={[styles.root, { backgroundColor: c.bg }]}
      edges={["top", "left", "right"]}
    >
      <StatusBar
        barStyle={isDark ? "light-content" : "dark-content"}
        translucent={Platform.OS === "android"}
        backgroundColor="transparent"
      />
      <LinearGradient
        colors={
          isDark
            ? [`${c.teal}14`, "transparent"]
            : ["#F8FAFC", "#F8FAFC", "transparent"]
        }
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingHorizontal: PROFILE_PAD }]}
        scrollEventThrottle={16}
        decelerationRate="normal"
        bounces={Platform.OS === "ios"}
        onScroll={scrollHandler}
      >
        <ProfileScreenHeader
          onNotifications={nav.openNotifications}
          onSettings={nav.openSettings}
        />
        <ProfileHeroCard
          onEdit={() => nav.showToast("Edit profile")}
          onAvatar={() => nav.showToast("Change profile photo")}
        />
        <ProfileEmailVerifyCard />
        <ProfilePremiumBanner onManage={nav.openPremium} />
        <ProfileQuickStatsGrid onStatPress={onStatPress} />
        <ProfileBookingsSection
          onViewAll={nav.goBookings}
          onBooking={(id, action) => {
            if (action === "Track") {
              nav.goBookings();
              return;
            }
            const serviceId = BOOKING_SERVICE[id] ?? "cleaning";
            nav.book({ service: serviceId });
          }}
        />
        <ProfileInsightsSection
          onViewAll={nav.goAi}
          onInsight={(id) => {
            const serviceId = INSIGHT_SERVICE[id] ?? "cleaning";
            nav.book({ service: serviceId });
          }}
        />
        <ProfileAddressesSection
          onManage={nav.openAddresses}
          onAddress={() => nav.openAddresses()}
          onAdd={nav.openAddresses}
        />
        <ProfileReferralCard />
        <ProfileSessionsSection />
        <ProfileHelpLinks />
        <Animated.View style={{ height: PROFILE_TAB_SPACER }} />
      </Animated.ScrollView>
    </SafeAreaView>
    </AuthGuard>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: { paddingTop: 8, paddingBottom: 8 },
});
