import { useState } from "react";
import { router } from "expo-router";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { PartnerScreen } from "@/components/PartnerScreen";
import { useAuthStore } from "@/stores/auth-store";
import { partnerColors } from "@/theme/colors";

export default function LoginScreen() {
  const login = useAuthStore((s) => s.login);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit() {
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      router.replace("/(tabs)");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <PartnerScreen
      title="Partner sign in"
      subtitle="Access Work HQ, earnings, attendance, and territory insights on the go."
    >
      <View style={styles.card}>
        <Text style={styles.label}>Email</Text>
        <TextInput
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
          placeholder="partner@example.com"
          placeholderTextColor="#94a3b8"
          style={styles.input}
        />
        <Text style={styles.label}>Password</Text>
        <TextInput
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          placeholder="••••••••"
          placeholderTextColor="#94a3b8"
          style={styles.input}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable
          onPress={() => void onSubmit()}
          disabled={loading || !email || !password}
          style={[styles.button, (loading || !email || !password) && styles.buttonDisabled]}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Continue to Partner OS</Text>
          )}
        </Pressable>
      </View>
    </PartnerScreen>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: "rgba(255,255,255,0.88)",
    borderRadius: 20,
    padding: 20,
    borderWidth: 1,
    borderColor: partnerColors.line,
  },
  label: { fontSize: 12, fontWeight: "600", color: partnerColors.textMuted, marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: partnerColors.line,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 14,
    fontSize: 15,
    color: partnerColors.text,
    backgroundColor: "#fff",
  },
  error: { color: partnerColors.danger, fontSize: 13, marginBottom: 10 },
  button: {
    marginTop: 4,
    backgroundColor: partnerColors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
  },
  buttonDisabled: { opacity: 0.6 },
  buttonText: { color: "#fff", fontSize: 15, fontWeight: "700" },
});
