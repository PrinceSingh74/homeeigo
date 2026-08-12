import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, Alert, ActivityIndicator } from "react-native";
import { Laptop, LogOut, Smartphone } from "lucide-react-native";
import Animated from "react-native-reanimated";
import { useTheme } from "@/hooks/useTheme";
import { useAppStore } from "@/lib/store";
import { authApi, type DeviceSession, type SessionsResponse } from "@/services/auth/auth-api";
import { getDeviceId } from "@/lib/auth/device";
import { PressableScale } from "@/components/ai/PressableScale";
import { SectionHeader } from "@/components/profile/SectionHeader";
import { profileEnter } from "@/lib/profile-animations";

function parseUA(ua: string | null) {
  const s = ua ?? "";
  const os = /Windows/i.test(s)
    ? "Windows"
    : /Android/i.test(s)
      ? "Android"
      : /iPhone|iPad|iOS/i.test(s)
        ? "iOS"
        : /Mac OS X|Macintosh/i.test(s)
          ? "macOS"
          : /Linux/i.test(s)
            ? "Linux"
            : "Unknown OS";
  const browser = /Edg\//i.test(s)
    ? "Edge"
    : /Chrome\//i.test(s)
      ? "Chrome"
      : /Firefox\//i.test(s)
        ? "Firefox"
        : /Safari\//i.test(s)
          ? "Safari"
          : /Expo|okhttp|Homeeigo/i.test(s)
            ? "Homeeigo App"
            : "Browser";
  const mobile = /Mobile|Android|iPhone|Expo|Homeeigo/i.test(s);
  return { browser, os, mobile };
}

function maskIp(ip: string | null) {
  if (!ip || ip === "unknown") return "Unknown";
  const p = ip.split(".");
  if (p.length === 4) return `${p[0]}.${p[1]}.XX.XX`;
  return ip.length > 6 ? `${ip.slice(0, 6)}…` : ip;
}

function timeAgo(iso: string | null) {
  if (!iso) return "—";
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (m < 1) return "Just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} hr ago`;
  const d = Math.floor(h / 24);
  if (d === 1) return "Yesterday";
  return d < 30 ? `${d} days ago` : new Date(iso).toLocaleDateString("en-IN");
}

function signedIn(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ProfileSessionsSection() {
  const { colors: c } = useTheme();
  const showToast = useAppStore((s) => s.showToast);
  const [data, setData] = useState<SessionsResponse | null>(null);
  const [error, setError] = useState(false);
  const currentDeviceId = getDeviceId() ?? "";

  const load = useCallback(async () => {
    setError(false);
    try {
      const res = await authApi.getSessions(currentDeviceId);
      setData(res.data ?? { sessions: [], currentSessionId: null });
    } catch {
      setError(true);
      setData({ sessions: [], currentSessionId: null });
    }
  }, [currentDeviceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const sessions = data?.sessions ?? [];
  const current = sessions.find((s) => s.isCurrent);
  const others = sessions.filter((s) => !s.isCurrent);

  const revokeOne = (s: DeviceSession, label: string) => {
    Alert.alert("Sign out device", `Sign out "${label}"? It will need to log in again.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out",
        style: "destructive",
        onPress: async () => {
          try {
            await authApi.revokeSession(s.id, currentDeviceId);
            showToast("Device signed out");
            await load();
          } catch {
            showToast("Could not sign out. Try again.");
          }
        },
      },
    ]);
  };

  const revokeOthers = () => {
    Alert.alert("Sign out others", `Sign out of ${others.length} other device(s)? Only this device stays logged in.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Sign out all",
        style: "destructive",
        onPress: async () => {
          try {
            const n = await authApi.revokeOtherSessions(currentDeviceId);
            showToast(`Signed out ${n.data?.revoked ?? 0} other device(s)`);
            await load();
          } catch {
            showToast("Could not complete. Try again.");
          }
        },
      },
    ]);
  };

  const Card = ({ s }: { s: DeviceSession }) => {
    const { browser, os, mobile } = parseUA(s.userAgent);
    const Icon = mobile ? Smartphone : Laptop;
    const label = s.deviceName || `${browser} on ${os}`;
    return (
      <View style={[styles.row, { backgroundColor: c.cardBg, borderColor: s.isCurrent ? c.primary : c.border }]}>
        <View style={[styles.rowIcon, { backgroundColor: `${c.primary}1A` }]}>
          <Icon size={20} color={c.primary} />
        </View>
        <View style={styles.rowBody}>
          <View style={styles.rowTitleRow}>
            <Text style={[styles.rowTitle, { color: c.text }]} numberOfLines={1}>
              {label}
            </Text>
            {s.isCurrent && (
              <View style={[styles.badge, { backgroundColor: `${c.success}1A` }]}>
                <Text style={[styles.badgeText, { color: c.success }]}>THIS DEVICE</Text>
              </View>
            )}
          </View>
          <Text style={[styles.muted, { color: c.textSecondary }]}>{os} · {browser}</Text>
          <Text style={[styles.muted, { color: c.textSecondary }]}>IP {maskIp(s.ipAddress)}</Text>
          <Text style={[styles.muted, { color: c.textSecondary }]}>
            Active {timeAgo(s.lastActivityAt ?? s.createdAt)} · since {signedIn(s.createdAt)}
          </Text>
        </View>
        {!s.isCurrent && (
          <PressableScale haptic onPress={() => revokeOne(s, label)} style={[styles.logoutBtn, { borderColor: c.border }]}>
            <LogOut size={16} color={c.error} />
          </PressableScale>
        )}
      </View>
    );
  };

  return (
    <Animated.View entering={profileEnter.section} style={styles.wrap}>
      <SectionHeader
        title="Devices & Sessions"
        onAction={others.length > 0 ? revokeOthers : undefined}
        actionLabel={others.length > 0 ? "Log out others" : undefined}
      />

      {data === null ? (
        <View style={[styles.state, { backgroundColor: c.cardBg, borderColor: c.border }]}>
          <ActivityIndicator color={c.primary} />
        </View>
      ) : error ? (
        <PressableScale onPress={() => void load()} style={[styles.state, { backgroundColor: c.cardBg, borderColor: c.border }]}>
          <Text style={[styles.muted, { color: c.textSecondary }]}>Could not load sessions. Tap to retry.</Text>
        </PressableScale>
      ) : sessions.length === 0 ? (
        <View style={[styles.state, { backgroundColor: c.cardBg, borderColor: c.border }]}>
          <Text style={[styles.muted, { color: c.textSecondary }]}>No active sessions.</Text>
        </View>
      ) : (
        <View style={styles.list}>
          {current && (
            <>
              <Text style={[styles.groupLabel, { color: c.textSecondary }]}>CURRENT DEVICE</Text>
              <Card s={current} />
            </>
          )}
          <Text style={[styles.groupLabel, { color: c.textSecondary }]}>OTHER DEVICES</Text>
          {others.length === 0 ? (
            <View style={[styles.emptyOther, { borderColor: c.border }]}>
              <Text style={[styles.muted, { color: c.textSecondary }]}>This is your only active session.</Text>
            </View>
          ) : (
            others.map((s) => <Card key={s.id} s={s} />)
          )}
        </View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginTop: 20 },
  list: { gap: 10, paddingHorizontal: 20 },
  groupLabel: { fontSize: 10, fontWeight: "800", letterSpacing: 1, marginTop: 4 },
  state: { marginHorizontal: 20, padding: 18, borderRadius: 16, borderWidth: 1, alignItems: "center" },
  emptyOther: { padding: 16, borderRadius: 14, borderWidth: 1, borderStyle: "dashed", alignItems: "center" },
  muted: { fontSize: 11, lineHeight: 16 },
  row: { flexDirection: "row", alignItems: "flex-start", gap: 12, padding: 13, borderRadius: 14, borderWidth: 1 },
  rowIcon: { width: 40, height: 40, borderRadius: 10, alignItems: "center", justifyContent: "center" },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  rowTitle: { fontSize: 13, fontWeight: "700", flexShrink: 1 },
  badge: { borderRadius: 6, paddingHorizontal: 5, paddingVertical: 1 },
  badgeText: { fontSize: 8, fontWeight: "800" },
  logoutBtn: { width: 36, height: 36, borderRadius: 10, borderWidth: 1, alignItems: "center", justifyContent: "center" },
});
