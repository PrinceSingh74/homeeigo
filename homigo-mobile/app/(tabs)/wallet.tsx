import React, { useCallback, useEffect, useState } from "react";
import { StyleSheet, View, StatusBar, Platform, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import Animated, {
  useSharedValue,
  useAnimatedScrollHandler,
} from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { useAppNavigation } from "@/hooks/useAppNavigation";
import { useScreenshotProtection } from "@/hooks/use-screenshot-protection";
import { WALLET_PAD, WALLET_TAB_SPACER } from "@/lib/wallet-layout";
import { WalletHeader } from "@/components/wallet/WalletHeader";
import { WalletHeroCard } from "@/components/wallet/WalletHeroCard";
import { WalletQuickActions } from "@/components/wallet/WalletQuickActions";
import { WalletOverviewSection } from "@/components/wallet/WalletOverviewSection";
import { WalletRecentTransactions } from "@/components/wallet/WalletRecentTransactions";
import { WalletPremiumBanner } from "@/components/wallet/WalletPremiumBanner";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { useWalletBalanceQuery, useWalletTransactionsQuery } from "@/hooks/use-core-data";
import { preloadRazorpayCheckout } from "@/hooks/use-razorpay-checkout";
import { HCoinsSheet } from "@/components/wallet/HCoinsSheet";
import { SendMoneySheet } from "@/components/wallet/SendMoneySheet";
import { GiftCardsSheet } from "@/components/wallet/GiftCardsSheet";

export default function WalletScreen() {
  const { colors: c, isDark } = useTheme();
  const { width } = useWindowDimensions();
  const nav = useAppNavigation();
  useScreenshotProtection(); // block screenshots/recording on the financial screen
  const [hcoinsOpen, setHcoinsOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [giftOpen, setGiftOpen] = useState(false);
  const scrollY = useSharedValue(0);
  useWalletBalanceQuery();
  useWalletTransactionsQuery();

  // Add-money uses Razorpay — warm the module so the checkout opens instantly.
  useEffect(() => {
    preloadRazorpayCheckout();
  }, []);

  const hPad = width >= 430 ? 20 : WALLET_PAD;

  const scrollHandler = useAnimatedScrollHandler({
    onScroll: (e) => {
      scrollY.value = e.contentOffset.y;
    },
  });

  const onQuickAction = useCallback(
    (id: string) => {
      if (id === "add") {
        nav.openAddMoney();
        return;
      }
      if (id === "send") {
        setSendOpen(true);
        return;
      }
      if (id === "gifts") {
        setGiftOpen(true);
        return;
      }
      if (id === "history") {
        nav.openTransactions();
        return;
      }
      if (id === "offers") {
        nav.goServices();
        return;
      }
      nav.openAddMoney();
    },
    [nav],
  );

  return (
    <AuthGuard title="Sign in to access your wallet">
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
            ? [`${c.teal}12`, "transparent"]
            : ["#F8FAFC", "#F8FAFC", "transparent"]
        }
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />

      <Animated.ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={[styles.scroll, { paddingHorizontal: hPad }]}
        scrollEventThrottle={16}
        decelerationRate="normal"
        bounces={Platform.OS === "ios"}
        overScrollMode="auto"
        onScroll={scrollHandler}
      >
        <WalletHeader
          scrollY={scrollY}
          onNotifications={nav.openNotifications}
          onProfile={nav.goProfile}
        />
        <WalletHeroCard
          onAddMoney={nav.openAddMoney}
          onPremium={nav.openPremium}
          onCoins={() => setHcoinsOpen(true)}
        />
        <WalletQuickActions onAction={onQuickAction} />
        <WalletOverviewSection onViewDetails={nav.openTransactions} />
        <WalletRecentTransactions onViewAll={nav.openTransactions} />
        <WalletPremiumBanner onUpgrade={nav.openPremium} />
        <View style={{ height: WALLET_TAB_SPACER }} />
      </Animated.ScrollView>
      <HCoinsSheet visible={hcoinsOpen} onClose={() => setHcoinsOpen(false)} />
      <SendMoneySheet visible={sendOpen} onClose={() => setSendOpen(false)} />
      <GiftCardsSheet visible={giftOpen} onClose={() => setGiftOpen(false)} />
    </SafeAreaView>
    </AuthGuard>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  scroll: {
    paddingTop: 8,
    paddingBottom: 16,
  },
});
