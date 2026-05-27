import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import Animated, { FadeInRight } from "react-native-reanimated";
import { WHY_FEATURES } from "@/constants/servicesData";
import { SectionHeader } from "./common/SectionHeader";
import { Premium3DCard } from "./visual/Premium3DCard";
import { PressableScale } from "@/components/ai/PressableScale";
import { useServicesTheme } from "./ServicesThemeContext";
import { useServicesActions } from "@/hooks/useServicesActions";
import { serviceType } from "@/theme/typography";
import { layout } from "@/theme/layout";

export function WhyChooseUs() {
  const { c, layout: L } = useServicesTheme();
  const actions = useServicesActions();

  const onFeaturePress = (title: string) => {
    switch (title) {
      case "Verified Professionals":
        actions.goProfile();
        break;
      case "Secure & Safe":
        actions.openWallet();
        break;
      case "AI-Powered Matching":
        actions.openAi();
        break;
      case "On-time Service":
        actions.openBookings();
        break;
      case "24/7 Support":
        actions.openAi();
        break;
      default:
        actions.openBookings();
    }
  };

  return (
    <View>
      <SectionHeader
        overline="Trust"
        title="Why Choose HOMIGO?"
        subtitle="Built for safety, speed, and peace of mind"
      />
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={L.listContent}
      >
        {WHY_FEATURES.map((f, index) => (
          <Animated.View
            key={f.title}
            entering={FadeInRight.delay(index * 65).springify()}
          >
            <PressableScale
              haptic
              scaleTo={0.97}
              onPress={() => onFeaturePress(f.title)}
            >
              <Premium3DCard
                radius={layout.cardRadius}
                depth="soft"
                style={{ width: L.whyCardW }}
              >
                <View style={styles.card}>
                  <View style={[styles.icon, { backgroundColor: f.bg }]}>
                    <Text style={styles.iconEmoji}>{f.icon}</Text>
                  </View>
                  <View style={styles.textCol}>
                    <Text style={[styles.title, { color: c.textPrimary }]}>
                      {f.title}
                    </Text>
                    <Text style={[styles.desc, { color: c.textMuted }]}>
                      {f.desc}
                    </Text>
                  </View>
                </View>
              </Premium3DCard>
            </PressableScale>
          </Animated.View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 16,
  },
  icon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
  },
  iconEmoji: { fontSize: 22 },
  textCol: { flex: 1 },
  title: { ...serviceType.cardTitleSm },
  desc: {
    ...serviceType.caption,
    marginTop: 4,
    lineHeight: 16,
  },
});
