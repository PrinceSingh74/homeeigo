import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { BadgeCheck, MailCheck, MailWarning } from "lucide-react-native";
import Animated from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { useAuthStore } from "@/stores/auth-store";
import { useAppStore } from "@/lib/store";
import { authApi } from "@/services/auth/auth-api";
import { AuthApiError } from "@/lib/auth/errors";
import { PressableScale } from "@/components/ai/PressableScale";
import { profileEnter } from "@/lib/profile-animations";

type SendState = "idle" | "sending" | "sent" | "rate_limited" | "error";

/**
 * Email verification (mobile parity with web).
 *   POST /api/auth/send-verification-email → emails a single-use 24h token link
 *   POST /api/auth/verify-email { token }  → consumed by the verify-email screen
 * Card surfaces status + (re)sends the link; never flips the badge itself.
 */
export function ProfileEmailVerifyCard() {
  const { colors: c } = useTheme();
  const user = useAuthStore((s) => s.user);
  const showToast = useAppStore((s) => s.showToast);
  const [state, setState] = useState<SendState>("idle");
  const [retryAfter, setRetryAfter] = useState(0);

  useEffect(() => {
    if (retryAfter <= 0) return;
    const t = setInterval(() => {
      setRetryAfter((p) => {
        const next = p - 1;
        if (next <= 0) {
          clearInterval(t);
          setState("idle");
        }
        return Math.max(0, next);
      });
    }, 1000);
    return () => clearInterval(t);
  }, [retryAfter]);

  useEffect(() => {
    if (state !== "sent") return;
    const t = setTimeout(() => setState("idle"), 8000);
    return () => clearTimeout(t);
  }, [state]);

  if (!user) return null;
  const verified = user.isEmailVerified;
  const verifiedAt = (user as { emailVerifiedAt?: string }).emailVerifiedAt;
  const tint = verified ? c.success : c.warning;

  const send = async () => {
    if (state === "sending" || state === "rate_limited") return;
    setState("sending");
    try {
      await authApi.sendVerificationEmail();
      setState("sent");
      showToast("Verification email sent — check your inbox");
    } catch (e) {
      if (e instanceof AuthApiError && (e.status === 429 || e.code === "RATE_LIMIT_EXCEEDED")) {
        setRetryAfter(300);
        setState("rate_limited");
      } else if (e instanceof AuthApiError && e.code === "EMAIL_ALREADY_VERIFIED") {
        showToast("Your email is already verified");
        setState("idle");
      } else {
        showToast("Could not send the email. Please try again.");
        setState("idle");
      }
    }
  };

  return (
    <Animated.View
      entering={profileEnter.section}
      style={[styles.card, { backgroundColor: c.cardBg, borderColor: c.border }]}
    >
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: `${tint}1A` }]}>
          {verified ? <BadgeCheck size={20} color={tint} /> : <MailWarning size={20} color={tint} />}
        </View>
        <View style={styles.body}>
          <View style={styles.titleRow}>
            <Text style={[styles.title, { color: c.text }]}>Email</Text>
            <View style={[styles.badge, { backgroundColor: `${tint}1A` }]}>
              <Text style={[styles.badgeText, { color: tint }]}>{verified ? "VERIFIED" : "UNVERIFIED"}</Text>
            </View>
          </View>
          <Text style={[styles.email, { color: c.textSecondary }]} numberOfLines={1}>
            {verified && verifiedAt
              ? `${user.email} · verified ${new Date(verifiedAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
              : user.email}
          </Text>
        </View>
        {!verified && state !== "sent" && (
          <PressableScale
            haptic
            disabled={state === "sending" || state === "rate_limited"}
            onPress={() => void send()}
            style={[styles.btn, { backgroundColor: c.primary, opacity: state === "sending" || state === "rate_limited" ? 0.5 : 1 }]}
          >
            {state === "sending" ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.btnText}>{state === "rate_limited" ? `${retryAfter}s` : "Verify"}</Text>
            )}
          </PressableScale>
        )}
      </View>

      {!verified && state === "sent" && (
        <View style={[styles.sentRow, { backgroundColor: `${c.primary}12` }]}>
          <MailCheck size={14} color={c.primary} />
          <Text style={[styles.sentText, { color: c.primary }]}>
            Check your inbox for the link — it expires in 24 hours.
          </Text>
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { marginHorizontal: 20, marginTop: 16, padding: 14, borderRadius: 16, borderWidth: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: 12 },
  icon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  body: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  title: { fontSize: 14, fontWeight: "700" },
  badge: { borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  badgeText: { fontSize: 9, fontWeight: "800" },
  email: { fontSize: 12, marginTop: 2 },
  btn: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 9, minWidth: 64, alignItems: "center" },
  btnText: { color: "#fff", fontSize: 12, fontWeight: "800" },
  sentRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12, padding: 10, borderRadius: 10 },
  sentText: { fontSize: 12, flex: 1 },
});
