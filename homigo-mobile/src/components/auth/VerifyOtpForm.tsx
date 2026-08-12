import React, { useEffect, useState } from "react";
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useLocalSearchParams } from "expo-router";
import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { OtpInput } from "@/components/auth/OtpInput";
import { formatPhoneDisplay } from "@/lib/auth/phone";
import {
  clearPendingRegistration,
  loadPendingRegistration,
} from "@/lib/auth/pending-registration";
import { verifyOtpSchema } from "@/lib/auth/schemas";
import { runAuthAction, useAuthStore } from "@/stores/auth-store";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/Button";
import { gradients, shadowStyles } from "@/lib/colors";
import { radius, spacing } from "@/lib/typography";

export function VerifyOtpForm() {
  const router = useRouter();
  const params = useLocalSearchParams<{ flow?: string; phone?: string }>();
  const flow = params.flow ?? "register";
  const phone = typeof params.phone === "string" ? params.phone : "";

  const register = useAuthStore((s) => s.register);
  const sendOtp = useAuthStore((s) => s.sendOtp);
  const verifyOtp = useAuthStore((s) => s.verifyOtp);
  const user = useAuthStore((s) => s.user);
  const setError = useAuthStore((s) => s.setError);
  const storeError = useAuthStore((s) => s.error);
  const devOtp = useAuthStore((s) => s.devOtp);
  const showToast = useAppStore((s) => s.showToast);

  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);

  // Dev convenience: when no SMS provider is configured the backend returns the
  // code, so we auto-fill it (the user can't see the server console).
  useEffect(() => {
    if (devOtp) setOtp(devOtp);
  }, [devOtp]);

  useEffect(() => {
    if (flow === "register" && !phone) router.replace("/signup");
  }, [flow, phone, router]);

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setInterval(() => setResendCooldown((s) => (s <= 1 ? 0 : s - 1)), 1000);
    return () => clearInterval(timer);
  }, [resendCooldown]);

  async function handleResend() {
    if (!phone || resendCooldown > 0) return;
    setIsLoading(true);
    const result = await runAuthAction(() => sendOtp(phone, user?.id), setError);
    setIsLoading(false);
    if (result.ok) {
      showToast("Code sent again");
      setResendCooldown(30);
    }
  }

  async function handleSubmit() {
    const parsed = verifyOtpSchema.safeParse({ otp });
    if (!parsed.success) {
      setOtpError(parsed.error.issues[0]?.message);
      return;
    }
    setOtpError(undefined);
    if (!phone) return;

    setIsLoading(true);

    if (flow === "register") {
      const pending = await loadPendingRegistration();
      if (!pending) {
        setIsLoading(false);
        showToast("Session expired. Please sign up again.");
        router.replace("/signup");
        return;
      }

      const result = await runAuthAction(
        () => register({ ...pending, otp: parsed.data.otp }),
        setError,
      );
      setIsLoading(false);

      if (result.ok) {
        await clearPendingRegistration();
        showToast("Welcome to Homeeigo");
        router.replace("/(tabs)");
      }
      return;
    }

    const result = await runAuthAction(
      () => verifyOtp(phone, parsed.data.otp, user?.id),
      setError,
    );
    setIsLoading(false);

    if (result.ok) {
      showToast("Phone verified");
      router.replace("/(tabs)/profile");
    }
  }

  return (
    <AuthPageShell
      title="Verify your number"
      subtitle={
        phone
          ? `Enter the 6-digit code sent to ${formatPhoneDisplay(phone)}`
          : "Enter the verification code"
      }
      footer={
        <Pressable onPress={() => router.push("/signup")}>
          <Text style={styles.footerLink}>Use a different number</Text>
        </Pressable>
      }
    >
      <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined}>
        {devOtp ? (
          <Pressable onPress={() => setOtp(devOtp)} style={styles.devBanner}>
            <Text style={styles.devBannerLabel}>DEV MODE · NO SMS SENT</Text>
            <Text style={styles.devBannerCode}>{devOtp}</Text>
            <Text style={styles.devBannerHint}>Auto-filled — tap to re-fill</Text>
          </Pressable>
        ) : null}
        <OtpInput value={otp} onChange={setOtp} disabled={isLoading} />
        {otpError || storeError ? (
          <Text style={styles.error}>{otpError ?? storeError}</Text>
        ) : null}

        <Button
            title="Verify & continue"
            onPress={() => void handleSubmit()}
            loading={isLoading}
            size="lg"
            style={styles.btnWrapWide}
          />

        <Pressable
          onPress={() => void handleResend()}
          disabled={isLoading || resendCooldown > 0}
          style={styles.resend}
        >
          <Text style={styles.resendText}>
            {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : "Resend code"}
          </Text>
        </Pressable>
      </KeyboardAvoidingView>
    </AuthPageShell>
  );
}

const styles = StyleSheet.create({
  btnWrap: { marginTop: spacing.sm },
  btnWrapWide: { marginTop: spacing['2xl'] },
  error: { color: "#EF4444", marginTop: 12 },
  resend: { marginTop: 18, alignItems: "center" },
  resendText: { color: "#2563EB", fontWeight: "700" },
  footerLink: { textAlign: "center", color: "#64748B" },
  devBanner: {
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    borderWidth: 1,
    borderRadius: radius.lg,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 16,
    alignItems: "center",
  },
  devBannerLabel: { color: "#2563EB", fontSize: 10, fontWeight: "800", letterSpacing: 1.2 },
  devBannerCode: { color: "#1E3A8A", fontSize: 22, fontWeight: "800", letterSpacing: 6, marginTop: 4 },
  devBannerHint: { color: "#64748B", fontSize: 11, marginTop: 2 },
});
