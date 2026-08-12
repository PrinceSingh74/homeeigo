import React, { useState } from "react";
import { Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { AuthTextField } from "@/components/auth/AuthTextField";
import { forgotPasswordSchema } from "@/lib/auth/schemas";
import { runAuthAction, useAuthStore } from "@/stores/auth-store";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/Button";
import { gradients, shadowStyles } from "@/lib/colors";
import { radius, spacing } from "@/lib/typography";

export function ForgotPasswordForm() {
  const router = useRouter();
  const forgotPassword = useAuthStore((s) => s.forgotPassword);
  const setError = useAuthStore((s) => s.setError);
  const storeError = useAuthStore((s) => s.error);
  const showToast = useAppStore((s) => s.showToast);
  const [email, setEmail] = useState("");
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleSubmit() {
    const parsed = forgotPasswordSchema.safeParse({ email });
    if (!parsed.success) {
      setFieldError(parsed.error.issues[0]?.message);
      return;
    }
    setFieldError(undefined);
    setIsLoading(true);
    const result = await runAuthAction(() => forgotPassword(parsed.data.email.trim()), setError);
    setIsLoading(false);
    if (result.ok) {
      setSent(true);
      showToast("If an account exists, reset instructions were sent");
    }
  }

  return (
    <AuthPageShell
      title="Reset password"
      subtitle="We'll email you a secure link to choose a new password."
      footer={
        <Pressable onPress={() => router.push("/login")}>
          <Text style={styles.footerLink}>Back to sign in</Text>
        </Pressable>
      }
    >
      {sent ? (
        <Text style={styles.success}>
          Check your email for a reset link. It may take a minute to arrive.
        </Text>
      ) : (
        <>
          <AuthTextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            errorMessage={fieldError}
            keyboardType="email-address"
            editable={!isLoading}
          />
          {storeError ? <Text style={styles.error}>{storeError}</Text> : null}
          <Button
            title="Send reset link"
            onPress={() => void handleSubmit()}
            loading={isLoading}
            size="lg"
            style={styles.btnWrap}
          />
        </>
      )}
    </AuthPageShell>
  );
}

const styles = StyleSheet.create({
  btnWrap: { marginTop: spacing.sm },
  error: { color: "#EF4444", marginBottom: 12 },
  success: { color: "#334155", lineHeight: 22, fontSize: 15 },
  footerLink: { textAlign: "center", color: "#2563EB", fontWeight: "700" },
});
