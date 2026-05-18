import React, { useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  Animated,
  Image,
  Easing,
  Dimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { ArrowRight, Sparkles } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { shadowStyles } from "@/lib/colors";

const WALLET_IMG = require("../../assets/wallet-3d.png");

const { width } = Dimensions.get("window");
const STAGE = width - 48;
const BANNER_W = STAGE * 0.6;
const SIDE_W = STAGE * 0.4 - 10;

function Waveform() {
  const bars = [0.35, 0.7, 0.5, 1, 0.6, 0.4, 0.8];
  const anims = useRef(bars.map((h) => new Animated.Value(h))).current;

  useEffect(() => {
    const loops = anims.map((val, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(val, {
            toValue: 1,
            duration: 420,
            delay: i * 70,
            easing: Easing.inOut(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(val, {
            toValue: bars[i] * 0.5,
            duration: 420,
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
            width: 3,
            borderRadius: 2,
            backgroundColor: "#06B6D4",
            height: val.interpolate({ inputRange: [0, 1], outputRange: [4, 18] }),
          }}
        />
      ))}
    </View>
  );
}

export const FeatureBanner: React.FC = () => {
  const { colors: themeColors } = useTheme();
  const float = useRef(new Animated.Value(0)).current;
  const trail = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.loop(
      Animated.sequence([
        Animated.timing(float, {
          toValue: -5,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(float, {
          toValue: 0,
          duration: 1500,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    ).start();
    Animated.loop(
      Animated.timing(trail, {
        toValue: 1,
        duration: 1300,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      }),
    ).start();
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        {/* LEFT — Light Speed banner */}
        <LinearGradient
          colors={["#0A0F1E", "#1E1B4B", "#2563EB"]}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={[styles.banner, shadowStyles.xl]}
        >
          <Text style={styles.eyebrow}>HOME SERVICES AT</Text>
          <Text style={styles.bannerTitle}>
            Light{"\n"}
            <Text style={{ color: themeColors.cyan }}>Speed.</Text>
          </Text>
          <Text style={styles.bannerSub}>
            Instant booking. Real-time tracking. Lightning fast service.
          </Text>

          <Pressable style={styles.bookBtn}>
            <Text style={styles.bookText}>Book Now</Text>
            <ArrowRight size={13} color="#1E1B4B" />
          </Pressable>

          {/* Rider + speed trails */}
          <View style={styles.rider} pointerEvents="none">
            {[0, 1, 2].map((i) => (
              <Animated.View
                key={i}
                style={{
                  position: "absolute",
                  right: 108,
                  top: 18 + i * 12,
                  width: 30 + i * 14,
                  height: 3,
                  borderRadius: 2,
                  backgroundColor:
                    i % 2 === 0 ? themeColors.cyan : themeColors.pink,
                  opacity: trail.interpolate({
                    inputRange: [0, 0.5, 1],
                    outputRange: [0, 0.85, 0],
                  }),
                  transform: [
                    {
                      translateX: trail.interpolate({
                        inputRange: [0, 1],
                        outputRange: [6, -12],
                      }),
                    },
                  ],
                }}
              />
            ))}
            <Animated.Image
              source={require("../../assets/rider.webp")}
              resizeMode="contain"
              style={[
                styles.riderImg,
                { transform: [{ translateY: float }] },
              ]}
            />
          </View>
        </LinearGradient>

        {/* RIGHT — stacked mini cards */}
        <View style={styles.side}>
          <LinearGradient
            colors={["#2563EB", "#7C3AED"]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={[styles.miniCard, shadowStyles.glowBlue]}
          >
            <View style={styles.miniTop}>
              <Text style={styles.miniGreet}>Hi Arjun! 👋</Text>
              <View style={styles.botOrb}>
                <Sparkles size={14} color="#fff" />
              </View>
            </View>
            <Text style={styles.miniSub}>How can I help you today?</Text>
            <View style={{ marginTop: 8 }}>
              <Waveform />
            </View>
          </LinearGradient>

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
            <View style={styles.miniTop}>
              <Text style={[styles.walletLabel, { color: themeColors.primary }]}>
                HOMIGO Wallet
              </Text>
              <Image
                source={WALLET_IMG}
                resizeMode="contain"
                style={styles.walletImg}
              />
            </View>
            <Text
              numberOfLines={1}
              adjustsFontSizeToFit
              style={[styles.walletAmt, { color: themeColors.text }]}
            >
              ₹2,450.00
            </Text>
            <Text
              style={[styles.walletSub, { color: themeColors.textSecondary }]}
            >
              Wallet Balance
            </Text>
          </View>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: 24,
    marginVertical: 20,
  },
  row: {
    flexDirection: "row",
    gap: 10,
  },
  banner: {
    width: BANNER_W,
    borderRadius: 22,
    padding: 16,
    paddingRight: 24,
    overflow: "hidden",
    justifyContent: "center",
  },
  eyebrow: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 1.2,
    color: "rgba(255,255,255,0.55)",
  },
  bannerTitle: {
    marginTop: 6,
    fontSize: 28,
    fontWeight: "800",
    color: "#fff",
    lineHeight: 30,
    letterSpacing: -0.5,
  },
  bannerSub: {
    marginTop: 8,
    fontSize: 10.5,
    color: "rgba(255,255,255,0.72)",
    lineHeight: 15,
    maxWidth: "78%",
  },
  bookBtn: {
    marginTop: 14,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    alignSelf: "flex-start",
    backgroundColor: "#fff",
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
  },
  bookText: { fontSize: 12, fontWeight: "800", color: "#1E1B4B" },
  rider: { position: "absolute", right: -8, bottom: 0 },
  riderImg: {
    width: 120,
    height: 84,
  },
  side: {
    width: SIDE_W,
    gap: 10,
    justifyContent: "space-between",
  },
  miniCard: {
    flex: 1,
    borderRadius: 18,
    padding: 12,
    justifyContent: "center",
  },
  miniTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  miniGreet: { fontSize: 12, fontWeight: "800", color: "#fff" },
  miniSub: {
    marginTop: 3,
    fontSize: 9.5,
    color: "rgba(255,255,255,0.85)",
  },
  botOrb: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },
  waveform: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 3,
    height: 18,
  },
  walletLabel: { fontSize: 10.5, fontWeight: "800" },
  walletImg: { width: 38, height: 38 },
  walletAmt: { marginTop: 10, fontSize: 17, fontWeight: "800" },
  walletSub: { marginTop: 1, fontSize: 9.5, fontWeight: "500" },
});
