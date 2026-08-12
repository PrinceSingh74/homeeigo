import React, { useEffect, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import { useTheme } from "@/hooks/useTheme";
import { apiRequest } from "@/services/auth/api-client";

const STORAGE_KEY = "homigo_cookie_consent";

export function CookieConsentBanner() {
  const router = useRouter();
  const { colors: c } = useTheme();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    void AsyncStorage.getItem(STORAGE_KEY).then((v) => {
      if (!v) setVisible(true);
    });
  }, []);

  async function record(granted: boolean) {
    await AsyncStorage.setItem(STORAGE_KEY, granted ? "granted" : "declined");
    setVisible(false);
    try {
      await apiRequest("/api/legal/consent/cookies", {
        method: "POST",
        body: { granted },
      });
    } catch {
      // non-blocking
    }
  }

  if (!visible) return null;

  return (
    <View style={[styles.wrap, { backgroundColor: c.cardBg, borderColor: c.border }]}>
      <Text style={[styles.text, { color: c.textSecondary }]}>
        We use essential cookies to keep you signed in and optional cookies to improve Homeeigo.{" "}
        <Text style={{ color: c.primary }} onPress={() => router.push("/legal/cookies")}>
          Cookie Policy
        </Text>
      </Text>
      <View style={styles.actions}>
        <Pressable style={[styles.btn, { backgroundColor: c.primary }]} onPress={() => void record(true)}>
          <Text style={styles.btnPrimary}>Accept</Text>
        </Pressable>
        <Pressable style={[styles.btn, styles.btnOutline, { borderColor: c.border }]} onPress={() => void record(false)}>
          <Text style={[styles.btnSecondary, { color: c.text }]}>Decline</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    left: 12,
    right: 12,
    bottom: 88,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    padding: 14,
    gap: 12,
    elevation: 8,
    shadowColor: "#000",
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  text: { fontSize: 13, lineHeight: 18 },
  actions: { flexDirection: "row", gap: 8 },
  btn: { flex: 1, borderRadius: 12, paddingVertical: 10, alignItems: "center" },
  btnOutline: { borderWidth: 1 },
  btnPrimary: { color: "#fff", fontWeight: "700", fontSize: 14 },
  btnSecondary: { fontWeight: "600", fontSize: 14 },
});
