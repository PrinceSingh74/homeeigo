import React, { useState } from "react";
import { Text, Pressable, StyleSheet, ActivityIndicator } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { AuthPageShell } from "@/components/auth/AuthPageShell";
import { AuthTextField } from "@/components/auth/AuthTextField";
import { authApi } from "@/services/auth/auth-api";
import { useAppStore } from "@/lib/store";
import { Button } from "@/components/Button";
import { gradients, shadowStyles } from "@/lib/colors";
import { radius, spacing } from "@/lib/typography";

export function ChangePasswordForm() {
  const router = useRouter();
  const showToast = useAppStore((s) => s.showToast);

  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit() {
    if (!current || !next) return setError("Enter your current and new password");
    if (next.length < 8) return setError("New password must be at least 8 characters");
    if (next !== confirm) return setError("New passwords do not match");
    if (next === current) return setError("New password must differ from the current one");
    setError(null);
    setIsLoading(true);
    try {
      await authApi.changePassword(current, next);
      showToast("Password updated successfully");
      router.back();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update password");
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <AuthPageShell title="Change password" subtitle="Update the password for your Homeeigo account.">
      <AuthTextField
        label="Current password"
        value={current}
        onChangeText={setCurrent}
        secureTextEntry
        editable={!isLoading}
      />
      <AuthTextField
        label="New password"
        value={next}
        onChangeText={setNext}
        secureTextEntry
        editable={!isLoading}
      />
      <AuthTextField
        label="Confirm new password"
        value={confirm}
        onChangeText={setConfirm}
        secureTextEntry
        editable={!isLoading}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
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
});
