import React from "react";
import { View, Text, StyleSheet, Image, ScrollView } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { ChevronRight } from "lucide-react-native";
import Animated from "react-native-reanimated";
import { PROFILE_PREMIUM_FEATURES } from "@/lib/profile-mobile-data";
import { PROFILE_CARD_RADIUS } from "@/lib/profile-layout";
import { spacing } from "@/lib/typography";
import { profileTextBase, profileType } from "@/lib/profile-typography";
import { PressableScale } from "@/components/ai/PressableScale";
import { profileEnter } from "@/lib/profile-animations";

const CROWN_IMG = require("../../../assets/crown-3d.png");

type Props = { onManage: () => void };

export function ProfilePremiumBanner({ onManage }: Props) {
  return (
    <Animated.View entering={profileEnter.premium} style={styles.outer}>
      <LinearGradient
        colors={["#6D28D9", "#7C3AED", "#C026D3"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        <Image source={CROWN_IMG} style={styles.crown} resizeMode="contain" />

        <View style={styles.content}>
          <View style={styles.titleRow}>
            <Text style={[profileType.premiumBrand, profileTextBase]}>HOMIGO PREMIUM</Text>
            <View style={styles.activeTag}>
              <Text style={[profileType.premiumActive, profileTextBase]}>ACTIVE</Text>
            </View>
          </View>
          <Text style={[profileType.premiumTagline, profileTextBase]}>
            Enjoy priority service, elite experts & more
          </Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.featuresScroll}
            style={styles.featuresWrap}
          >
            {PROFILE_PREMIUM_FEATURES.map((f) => {
              const Icon = f.icon;
              return (
                <View key={f.label} style={styles.feature}>
                  <Icon size={20} color="#fff" strokeWidth={2} />
                  <Text
                    style={[profileType.premiumFeature, profileTextBase]}
                    numberOfLines={2}
                  >
                    {f.label}
                  </Text>
                </View>
              );
            })}
          </ScrollView>

          <PressableScale onPress={onManage} haptic style={styles.btnWrap}>
            <View style={styles.btn}>
              <Text style={[profileType.premiumBtn, profileTextBase]}>Manage Membership</Text>
              <ChevronRight size={14} color="#7C3AED" strokeWidth={2.5} />
            </View>
          </PressableScale>
        </View>
      </LinearGradient>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  outer: { marginBottom: spacing.xl },
  card: {
    borderRadius: PROFILE_CARD_RADIUS,
    minHeight: 200,
    padding: spacing.lg,
    overflow: "hidden",
    shadowColor: "#7C3AED",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.35,
    shadowRadius: 24,
    elevation: 10,
  },
  crown: {
    position: "absolute",
    right: 12,
    top: 16,
    width: 80,
    height: 80,
    opacity: 0.95,
  },
  content: { paddingRight: 72, gap: 8 },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 8,
  },
  activeTag: {
    backgroundColor: "rgba(16, 185, 129, 0.95)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  featuresWrap: { marginTop: 4, marginHorizontal: -4 },
  featuresScroll: { gap: 16, paddingHorizontal: 4, paddingVertical: 4 },
  feature: {
    alignItems: "center",
    width: 64,
    gap: 6,
  },
  btnWrap: { alignSelf: "flex-start", marginTop: 8 },
  btn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#fff",
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 4,
  },
});
