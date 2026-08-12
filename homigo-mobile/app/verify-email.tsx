import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator, SafeAreaView } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { CheckCircle2, XCircle } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { authApi } from "@/services/auth/auth-api";
import { AuthApiError } from "@/lib/auth/errors";
import { useAuthStore } from "@/stores/auth-store";
import { PressableScale } from "@/components/ai/PressableScale";

type State = "verifying" | "success" | "error";

/**
 * Deep-link target: homigo://verify-email?token=…
 * Consumes the verification token against the backend (single source of truth),
 * refreshes the user, then routes to the profile. No reload — pure client flow.
 */
export default function VerifyEmailScreen() {
  const { colors: c } = useTheme();
  const router = useRouter();
  const { token } = useLocalSearchParams<{ token?: string }>();
  const fetchCurrentUser = useAuthStore((s) => s.fetchCurrentUser);
  const [state, setState] = useState<State>("verifying");
  const [error, setError] = useState<string | null>(null);
  const ran = useRef(false);

  const verify = async () => {
    if (!token) {
      setState("error");
      setError("No verification token found in the link.");
      return;
    }
    setState("verifying");
    try {
      await authApi.verifyEmail(token);
      try {
        await fetchCurrentUser();
      } catch {
        /* not logged in here — verification still succeeded */
      }
      setState("success");
      setTimeout(() => router.replace("/(tabs)/profile"), 2500);
    } catch (e) {
      setState("error");
      setError(
        e instanceof AuthApiError && e.code === "EMAIL_ALREADY_VERIFIED"
          ? "This email is already verified. You're all set."
          : "This verification link is invalid or has expired. Please request a new one.",
      );
    }
  };

  useEffect(() => {
    if (ran.current) return;
    ran.current = true;
    void verify();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SafeAreaView style={[styles.wrap, { backgroundColor: c.bg }]}>
      <View style={[styles.card, { backgroundColor: c.cardBg, borderColor: c.border }]}>
        <Text style={[styles.logo, { color: c.primary }]}>HOMIGO</Text>

        {state === "verifying" && (
          <>
            <ActivityIndicator size="large" color={c.primary} />
            <Text style={[styles.title, { color: c.text }]}>Verifying your email…</Text>
            <Text style={[styles.sub, { color: c.textSecondary }]}>Please wait a moment.</Text>
          </>
        )}

        {state === "success" && (
          <>
            <CheckCircle2 size={52} color={c.success} />
            <Text style={[styles.title, { color: c.text }]}>Email verified!</Text>
            <Text style={[styles.sub, { color: c.textSecondary }]}>Taking you to your profile…</Text>
          </>
        )}

        {state === "error" && (
          <>
            <XCircle size={52} color={c.error} />
            <Text style={[styles.title, { color: c.text }]}>Verification failed</Text>
            <Text style={[styles.sub, { color: c.textSecondary }]}>{error}</Text>
            <View style={styles.btnRow}>
              <PressableScale haptic onPress={() => void verify()} style={[styles.btn, { backgroundColor: c.primary }]}>
                <Text style={styles.btnText}>Try again</Text>
              </PressableScale>
              <PressableScale haptic onPress={() => router.replace("/(tabs)")} style={[styles.outlineBtn, { borderColor: c.border }]}>
                <Text style={[styles.outlineBtnText, { color: c.text }]}>Go home</Text>
              </PressableScale>
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  card: { width: "100%", maxWidth: 400, alignItems: "center", gap: 14, padding: 28, borderRadius: 24, borderWidth: 1 },
  logo: { fontSize: 22, fontWeight: "800", marginBottom: 8 },
  title: { fontSize: 19, fontWeight: "800", textAlign: "center" },
  sub: { fontSize: 13, textAlign: "center", lineHeight: 19 },
  btnRow: { flexDirection: "row", gap: 10, marginTop: 8, width: "100%" },
  btn: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: "center" },
  btnText: { color: "#fff", fontSize: 14, fontWeight: "800" },
  outlineBtn: { flex: 1, borderRadius: 12, paddingVertical: 12, alignItems: "center", borderWidth: 1 },
  outlineBtnText: { fontSize: 14, fontWeight: "700" },
});
