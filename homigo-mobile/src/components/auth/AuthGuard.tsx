import React, { useEffect } from "react";
import { View, ActivityIndicator, StyleSheet, Pressable, Text } from "react-native";
import { useNavigationContainerRef, useRouter } from "expo-router";
import { useAuth } from "@/hooks/use-auth";
import { useTheme } from "@/hooks/useTheme";
import { authGuardDecision, shouldNavigateToSignIn } from "@/lib/auth/guard-decision";

type Props = {
  children: React.ReactNode;
  title?: string;
};

export function AuthGuard({ children, title = "Sign in required" }: Props) {
  const router = useRouter();
  const navigationRef = useNavigationContainerRef();
  const { colors: c } = useTheme();
  const { isAuthenticated, status } = useAuth();
  const decision = authGuardDecision(status, isAuthenticated);

  useEffect(() => {
    if (decision !== "sign_in") return;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const attempt = () => {
      // On a cold start the container becomes ready within the first frames; readiness is not
      // observable as state, so check again shortly rather than navigate early.
      if (shouldNavigateToSignIn(decision, navigationRef.isReady())) router.push("/login");
      else retry = setTimeout(attempt, 50);
    };
    attempt();
    return () => clearTimeout(retry);
  }, [decision, navigationRef, router]);

  if (decision === "wait") {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        <ActivityIndicator size="large" color={c.primary} />
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <View style={[styles.center, { backgroundColor: c.bg }]}>
        <Text style={[styles.title, { color: c.text }]}>{title}</Text>
        <Pressable onPress={() => router.push("/login")} style={[styles.btn, { backgroundColor: c.primary }]}>
          <Text style={styles.btnText}>Sign in</Text>
        </Pressable>
      </View>
    );
  }

  return <>{children}</>;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
  title: { fontSize: 18, fontWeight: "600", marginBottom: 16, textAlign: "center" },
  btn: { paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 },
  btnText: { color: "#fff", fontWeight: "700", fontSize: 16 },
});
