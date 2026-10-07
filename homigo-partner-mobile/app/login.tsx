import { router } from "expo-router";
import { LogIn } from "lucide-react-native";
import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { PartnerScreen } from "@/components/PartnerScreen";
import { Banner, Button, Card, Field, T } from "@/components/ui";
import { useAuthStore } from "@/stores/auth-store";
import { space } from "@/theme/tokens";

export default function LoginScreen() {
  const login = useAuthStore((s) => s.login);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    if (loading || !email || !password) return;
    setError(null);
    setLoading(true);
    try {
      await login(email.trim(), password);
      router.replace("/(tabs)");
    } catch (e) {
      // The server's own sentence (wrong password, account not approved yet, …).
      setError(e instanceof Error && e.message ? e.message : "Sign in did not go through. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <PartnerScreen title="Partner sign in" subtitle="Your jobs, your earnings and your day, in one place.">
        <Card style={styles.card}>
          <Field
            testID="partner-login-email"
            label="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            keyboardType="email-address"
            returnKeyType="next"
            placeholder="you@example.com"
          />
          <Field
            testID="partner-login-password"
            label="Password"
            value={password}
            onChangeText={setPassword}
            secure
            autoComplete="password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => void onSubmit()}
          />
          {error ? <Banner tone="danger" message={error} testID="partner-login-error" /> : null}
          <Button
            testID="partner-login-submit"
            label="Continue to Partner OS"
            icon={LogIn}
            onPress={() => void onSubmit()}
            loading={loading}
            disabled={!email || !password}
          />
        </Card>
        <View style={styles.apply}>
          <T kind="small">New to HOMEEIGO?</T>
          <Button label="Apply to become a partner" variant="quiet" onPress={() => router.push("/register")} />
        </View>
      </PartnerScreen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  card: { gap: space.lg },
  apply: { marginTop: space.xxl, alignItems: "center", gap: space.xs },
});
