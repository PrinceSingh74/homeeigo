import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { useRouter, useLocalSearchParams } from "expo-router";
import Constants, { ExecutionEnvironment } from "expo-constants";
import { useTheme } from "@/hooks/useTheme";
import { useOAuthLogin } from "@/hooks/use-oauth-login";
import { useAppStore } from "@/lib/store";
import { radius } from "@/lib/typography";

// Google/Apple OAuth uses a custom-scheme deep-link redirect that only works in a
// real (development/standalone) app build — never in Expo Go. Detect Expo Go so we
// can guide the user to email/OTP instead of opening a browser to an unreachable URL.
const IS_EXPO_GO = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;

type Props = {
  disabled?: boolean;
  withDivider?: boolean;
};

export function OAuthProviderButtons({ disabled, withDivider = true }: Props) {
  const { colors: c } = useTheme();
  const router = useRouter();
  const params = useLocalSearchParams<{ returnUrl?: string }>();
  const showToast = useAppStore((s) => s.showToast);
  const { startGoogle, startApple } = useOAuthLogin();
  const [loading, setLoading] = useState<"google" | "apple" | null>(null);

  async function handleStart(provider: "google" | "apple") {
    if (IS_EXPO_GO) {
      showToast(
        `${provider === "google" ? "Google" : "Apple"} sign-in isn't available in Expo Go. Please use email or phone OTP.`,
      );
      return;
    }
    setLoading(provider);
    try {
      const result =
        provider === "google"
          ? await startGoogle(params.returnUrl)
          : await startApple(params.returnUrl);
      if (result.ok) {
        showToast("Signed in successfully");
        router.replace((result.returnUrl as "/(tabs)") ?? "/(tabs)");
      } else {
        showToast(result.message);
      }
    } catch {
      showToast("Sign-in failed. Please try again.");
    } finally {
      setLoading(null);
    }
  }

  return (
    <View style={styles.wrap}>
      {withDivider ? (
        <View style={styles.dividerRow}>
          <View style={[styles.line, { backgroundColor: c.border }]} />
          <Text style={[styles.dividerText, { color: c.textSecondary }]}>or continue with</Text>
          <View style={[styles.line, { backgroundColor: c.border }]} />
        </View>
      ) : null}

      <Pressable
        disabled={disabled || loading !== null}
        onPress={() => void handleStart("google")}
        style={[styles.btn, { borderColor: c.border, backgroundColor: c.cardBg }, IS_EXPO_GO && styles.btnUnavailable]}
      >
        {loading === "google" ? (
          <ActivityIndicator color={c.primary} />
        ) : (
          <Text style={[styles.btnText, { color: c.text }]}>Continue with Google</Text>
        )}
      </Pressable>

      <Pressable
        disabled={disabled || loading !== null}
        onPress={() => void handleStart("apple")}
        style={[styles.btn, { borderColor: c.border, backgroundColor: c.cardBg }, IS_EXPO_GO && styles.btnUnavailable]}
      >
        {loading === "apple" ? (
          <ActivityIndicator color={c.primary} />
        ) : (
          <Text style={[styles.btnText, { color: c.text }]}>Continue with Apple</Text>
        )}
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12, marginTop: 8 },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: 10, marginVertical: 8 },
  line: { flex: 1, height: 1 },
  dividerText: { fontSize: 12, fontWeight: "600" },
  btn: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
  },
  btnText: { fontSize: 15, fontWeight: "700" },
  btnUnavailable: { opacity: 0.55 },
});
