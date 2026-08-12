import React, { useState } from "react";
import { Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter, useLocalSearchParams } from "expo-router";
import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { AuthTextField } from "@/components/auth/AuthTextField";
import { resetPasswordSchema } from "@/lib/auth/schemas";
import { runAuthAction, useAuthStore } from "@/stores/auth-store";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/Button";
import { gradients, shadowStyles } from "@/lib/colors";
import { radius, spacing } from "@/lib/typography";

export function ResetPasswordForm() {
  const router = useRouter();
  const params = useLocalSearchParams<{ token?: string }>();
  const token = typeof params.token === "string" ? params.token : "";
  const resetPassword = useAuthStore((s) => s.resetPassword);
  const setError = useAuthStore((s) => s.setError);
  const storeError = useAuthStore((s) => s.error);
  const showToast = useAppStore((s) => s.showToast);

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ newPassword?: string; confirmPassword?: string }>(
    {},
  );
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit() {
    const parsed = resetPasswordSchema.safeParse({ newPassword, confirmPassword });
    if (!parsed.success) {
      const errors: { newPassword?: string; confirmPassword?: string } = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as "newPassword" | "confirmPassword";
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    if (!token) {
      showToast("Invalid reset link");
      return;
    }
    setFieldErrors({});
    setIsLoading(true);
    const result = await runAuthAction(
      () => resetPassword(token, parsed.data.newPassword),
      setError,
    );
    setIsLoading(false);
    if (result.ok) {
      showToast("Password updated. Please sign in.");
      router.replace("/login");
    }
  }

  if (!token) {
    return (
      <AuthPageShell title="Invalid reset link" subtitle="Request a new password reset email.">
        <Pressable onPress={() => router.push("/forgot-password")}>
          <Text style={styles.link}>Request new link</Text>
        </Pressable>
      </AuthPageShell>
    );
  }

  return (
    <AuthPageShell title="Choose a new password" subtitle="Use a strong password you haven't used here before.">
      <AuthTextField
        label="New password"
        value={newPassword}
        onChangeText={setNewPassword}
        errorMessage={fieldErrors.newPassword}
        secureTextEntry
        editable={!isLoading}
      />
      <AuthTextField
        label="Confirm password"
        value={confirmPassword}
        onChangeText={setConfirmPassword}
        errorMessage={fieldErrors.confirmPassword}
        secureTextEntry
        editable={!isLoading}
      />
      {storeError ? <Text style={styles.error}>{storeError}</Text> : null}
      <Button
            title="Update password"
            onPress={() => void handleSubmit()}
            loading={isLoading}
            size="lg"
            style={styles.btnWrap}
          />
    </AuthPageShell>
  );
}

const styles = StyleSheet.create({
  btnWrap: { marginTop: spacing.sm },
  error: { color: "#EF4444", marginBottom: 12 },
  link: { color: "#2563EB", fontWeight: "700" },
});
