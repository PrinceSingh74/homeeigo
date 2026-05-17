import React, { useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Easing,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowRight, Bike, Bot, Wallet } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";

function Waveform() {
  const bars = [0.4, 0.8, 0.55, 1, 0.65, 0.45];
  const anims = useRef(bars.map((h) => new Animated.Value(h))).current;

  useEffect(() => {
    const loops = anims.map((val, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(val, {
            toValue: 1,
            duration: 450,
            delay: i * 80,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(val, {
            toValue: bars[i] * 0.6,
            duration: 450,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
  }, []);

  return (
    <View style={styles.waveform}>
      {anims.map((val, i) => (
        <Animated.View
          key={i}
          style={{
            width: 4,
            borderRadius: 2,
            backgroundColor: "rgba(255,255,255,0.8)",
            height: val.interpolate({
              inputRange: [0, 1],
              outputRange: [6, 24],
            }),
          }}
        />
      ))}
    </View>
  );
}

export const FeatureBanner: React.FC = () => {
  const { colors: themeColors } = useTheme();
  const floatAnim = useRef(new Animated.Value(0)).current;
  const trailAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, {
          toValue: -6,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(floatAnim, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ).start();

    Animated.loop(
      Animated.timing(trailAnim, {
        toValue: 1,
        duration: 1400,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    ).start();
  }, []);

  return (
    <View style={styles.container}>
      {/* Main Light Speed banner */}
      <LinearGradient
        colors={["#1E1B4B", "#4C1D95", "#312E81"]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.banner, shadowStyles.lg]}
      >
        <Text style={styles.eyebrow}>HOME SERVICES AT</Text>
        <Text style={styles.bannerTitle}>
          Light{" "}
          <Text style={{ color: themeColors.cyan }}>Speed.</Text>
        </Text>
        <Text style={styles.bannerSubtitle}>
          Instant booking, real-time tracking, lightning-fast service at your
          doorstep.
        </Text>

        <TouchableOpacity activeOpacity={0.85} style={styles.bookButton}>
          <Text style={styles.bookButtonText}>Book Now</Text>
          <ArrowRight size={16} color="#1E1B4B" />
        </TouchableOpacity>

        {/* Animated rider with speed trails */}
        <View style={styles.riderWrapper} pointerEvents="none">
          {[0, 1, 2].map((i) => (
            <Animated.View
              key={i}
              style={{
                position: "absolute",
                right: 64,
                top: 8 + i * 12,
                width: 36 + i * 14,
                height: 4,
                borderRadius: 2,
                backgroundColor: i % 2 === 0 ? themeColors.cyan : themeColors.pink,
                opacity: trailAnim.interpolate({
                  inputRange: [0, 0.5, 1],
                  outputRange: [0, 0.8, 0],
                }),
                transform: [
                  {
                    translateX: trailAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [8, -14],
                    }),
                  },
                ],
              }}
            />
          ))}
          <Animated.View
            style={{
              width: 84,
              height: 84,
              borderRadius: 18,
              backgroundColor: "rgba(255,255,255,0.1)",
              justifyContent: "center",
              alignItems: "center",
              transform: [{ translateY: floatAnim }],
            }}
          >
            <Bike size={48} color="white" strokeWidth={1.5} />
          </Animated.View>
        </View>
      </LinearGradient>

      {/* Mini cards row */}
      <View style={styles.miniRow}>
        {/* AI assistant card */}
        <LinearGradient
          colors={["#2563EB", "#7C3AED"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.miniCard, shadowStyles.md]}
        >
          <View style={styles.miniHeaderRow}>
            <Text style={styles.miniGreeting}>Hi Arjun! 👋</Text>
            <View style={styles.botBadge}>
              <Bot size={18} color="white" />
            </View>
          </View>
          <Text style={styles.miniSub}>How can I help you today?</Text>
          <View style={{ marginTop: 10 }}>
            <Waveform />
          </View>
        </LinearGradient>

        {/* Wallet card */}
        <View
          style={[
            styles.miniCard,
            {
              backgroundColor: themeColors.cardBg,
              borderColor: themeColors.border,
              borderWidth: 1,
            },
            shadowStyles.md,
          ]}
        >
          <View style={styles.miniHeaderRow}>
            <Text style={[styles.walletLabel, { color: themeColors.primary }]}>
              HOMIGO Wallet
            </Text>
            <View
              style={[
                styles.walletBadge,
                { backgroundColor: "rgba(37,99,235,0.1)" },
              ]}
            >
              <Wallet size={18} color={themeColors.primary} />
            </View>
          </View>
          <Text style={[styles.walletAmount, { color: themeColors.text }]}>
            ₹2,450.00
          </Text>
          <Text style={[styles.walletSub, { color: themeColors.textSecondary }]}>
            Wallet Balance
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 16,
    marginVertical: 8,
    gap: 12,
  },
  banner: {
    borderRadius: 24,
    padding: 24,
    minHeight: 220,
    justifyContent: "center",
    overflow: "hidden",
  },
  eyebrow: {
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 1.5,
    color: "rgba(255,255,255,0.55)",
    textTransform: "uppercase",
  },
  bannerTitle: {
    marginTop: 8,
    fontSize: 40,
    fontWeight: "700",
    color: "white",
  },
  bannerSubtitle: {
    marginTop: 10,
    fontSize: 14,
    color: "rgba(255,255,255,0.75)",
    maxWidth: "70%",
  },
  bookButton: {
    marginTop: 18,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    alignSelf: "flex-start",
    backgroundColor: "white",
    paddingHorizontal: 22,
    paddingVertical: 12,
    borderRadius: 14,
  },
  bookButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: "#1E1B4B",
  },
  riderWrapper: {
    position: "absolute",
    right: 4,
    bottom: 16,
  },
  miniRow: {
    flexDirection: "row",
    gap: 12,
  },
  miniCard: {
    flex: 1,
    borderRadius: 20,
    padding: 16,
    minHeight: 130,
  },
  miniHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  miniGreeting: {
    fontSize: 16,
    fontWeight: "700",
    color: "white",
  },
  miniSub: {
    marginTop: 4,
    fontSize: 12,
    color: "rgba(255,255,255,0.8)",
  },
  botBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(255,255,255,0.2)",
    justifyContent: "center",
    alignItems: "center",
  },
  waveform: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 4,
    height: 24,
  },
  walletLabel: {
    fontSize: 14,
    fontWeight: "700",
  },
  walletBadge: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: "center",
    alignItems: "center",
  },
  walletAmount: {
    marginTop: 16,
    fontSize: 26,
    fontWeight: "700",
  },
  walletSub: {
    marginTop: 2,
    fontSize: 12,
  },
});
