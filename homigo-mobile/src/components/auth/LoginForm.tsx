import React, { useState } from "react";
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Image,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { LogIn } from "lucide-react-native";
import { useTheme } from "@/hooks/useTheme";
import { runAuthAction, useAuthStore } from "@/stores/auth-store";
import { useAppStore } from "@/lib/store";
import { loginSchema } from "@/lib/auth/schemas";
import { OAuthProviderButtons } from "@/components/auth/OAuthProviderButtons";
import { AuthTextField } from "@/components/auth/AuthTextField";
import { Button } from "@/components/Button";
import { gradients, shadowStyles } from "@/lib/colors";
import { spacing, radius, type } from "@/lib/typography";

export function LoginForm() {
  const router = useRouter();
  const { colors: c, isDark } = useTheme();
  const login = useAuthStore((s) => s.login);
  const setError = useAuthStore((s) => s.setError);
  const storeError = useAuthStore((s) => s.error);
  const showToast = useAppStore((s) => s.showToast);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [isLoading, setIsLoading] = useState(false);

  async function handleSubmit() {
    const parsed = loginSchema.safeParse({ email, password });
    if (!parsed.success) {
      const errors: { email?: string; password?: string } = {};
      for (const issue of parsed.error.issues) {
        const key = issue.path[0] as "email" | "password";
        if (!errors[key]) errors[key] = issue.message;
      }
      setFieldErrors(errors);
      return;
    }
    setFieldErrors({});
    setIsLoading(true);
    const result = await runAuthAction(
      () => login(parsed.data.email, parsed.data.password),
      setError,
    );
    setIsLoading(false);
    if (result.ok) {
      showToast("Welcome back to Homeeigo");
      router.replace("/(tabs)");
    }
  }

  return (
    <SafeAreaView style={[styles.root, { backgroundColor: c.bg }]}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <LinearGradient colors={[`${c.primary}18`, "transparent"]} style={styles.heroGlow} />
          <Image
            source={
              isDark
                ? require("../../../assets/brand/logo-full-dark.png")
                : require("../../../assets/brand/logo-full.png")
            }
            style={styles.brandLogo}
            resizeMode="contain"
            accessibilityIgnoresInvertColors
            accessibilityLabel="Homeeigo"
          />
          <Text style={[styles.title, { color: c.text }]}>Welcome back</Text>
          <Text style={[styles.sub, { color: c.textSecondary }]}>
            Sign in to manage bookings, wallet, and live tracking.
          </Text>

          <AuthTextField
            label="Email"
            value={email}
            onChangeText={setEmail}
            errorMessage={fieldErrors.email}
            autoCapitalize="none"
            keyboardType="email-address"
            editable={!isLoading}
          />
          <AuthTextField
            label="Password"
            value={password}
            onChangeText={setPassword}
            errorMessage={fieldErrors.password}
            secureTextEntry
            editable={!isLoading}
          />

          <Pressable onPress={() => router.push("/forgot-password")} style={styles.forgot}>
            <Text style={[styles.forgotText, { color: c.primary }]}>Forgot password?</Text>
          </Pressable>

          {storeError ? (
            <Text style={[styles.error, { color: "#EF4444" }]}>{storeError}</Text>
          ) : null}

          {/* Shared Button: same gradient, padding, radius and label size this
              hand-rolled markup had, and it additionally announces itself as a
              button, exposes its busy/disabled state, and meets the touch target. */}
          <Button
            title="Sign in"
            onPress={() => void handleSubmit()}
            loading={isLoading}
            size="lg"
            style={styles.btnWrap}
            icon={<LogIn size={20} color="#fff" />}
          />

          <OAuthProviderButtons disabled={isLoading} />

          <View style={styles.footer}>
            <Text style={[styles.footerText, { color: c.textSecondary }]}>
              New to Homeeigo?{" "}
            </Text>
            <Pressable onPress={() => router.push("/signup")}>
              <Text style={[styles.footerLink, { color: c.primary }]}>Create account</Text>
            </Pressable>
          </View>

          <Pressable onPress={() => router.back()} style={styles.skip}>
            <Text style={[styles.skipText, { color: c.textSecondary }]}>Continue browsing</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  scroll: { padding: spacing.lg, paddingTop: spacing.xl },
  heroGlow: { ...StyleSheet.absoluteFillObject, height: 220 },
  /** Full brand lockup — the hero moment on the login screen. */
  brandLogo: { width: 196, height: 135, marginBottom: spacing.md, alignSelf: "flex-start" },
  title: { ...type.headline, marginBottom: spacing.xs },
  sub: { ...type.body, marginBottom: spacing.xl, lineHeight: 22 },
  forgot: { alignSelf: "flex-end", marginBottom: 12 },
  forgotText: { fontSize: 14, fontWeight: "600" },
  error: { marginBottom: 12, fontSize: 14 },
  btnWrap: { marginTop: spacing.sm },
  footer: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 20,
  },
  footerText: { fontSize: 15 },
  footerLink: { fontSize: 15, fontWeight: "700" },
  skip: { alignItems: "center", marginTop: 16, padding: 12 },
  skipText: { fontSize: 15, fontWeight: "600" },
});
