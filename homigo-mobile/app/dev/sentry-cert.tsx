import React, { useState } from "react";
import { ScrollView, Text, View, Pressable, Platform } from "react-native";
import { Redirect, Stack } from "expo-router";
import Constants from "expo-constants";
import { useAuthStore } from "@/stores/auth-store";
import { triggerSentryNativeCrash, triggerSentryTestException } from "@/lib/observability/sentry";
import { getStartupTimeline } from "@/lib/startup-trace";

const CERT_ENABLED = process.env.EXPO_PUBLIC_SENTRY_CERT_ENABLED === "true";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        justifyContent: "space-between",
        paddingVertical: 6,
        borderBottomWidth: 1,
        borderBottomColor: "#E2E8F0",
      }}
    >
      <Text style={{ color: "#64748B", fontSize: 13, flex: 1 }}>{label}</Text>
      <Text style={{ color: "#0F172A", fontSize: 13, fontWeight: "600", flex: 1.2, textAlign: "right" }}>
        {value}
      </Text>
    </View>
  );
}

export default function SentryCertScreen() {
  if (!CERT_ENABLED) return <Redirect href="/(tabs)" />;

  const authStatus = useAuthStore((s) => s.status);
  const userId = useAuthStore((s) => s.user?.id);
  const [jsResult, setJsResult] = useState<string | null>(null);
  const [nativeResult, setNativeResult] = useState<string | null>(null);

  const timeline = getStartupTimeline();
  const buildVersion =
    Platform.OS === "ios"
      ? (Constants.expoConfig?.ios?.buildNumber ?? "?")
      : String(Constants.expoConfig?.android?.versionCode ?? "?");

  return (
    <>
      <Stack.Screen options={{ title: "Sentry Device Cert", headerShown: true }} />
      <ScrollView style={{ flex: 1, backgroundColor: "#F1F5F9" }} contentContainerStyle={{ padding: 16 }}>
        <Text style={{ fontSize: 22, fontWeight: "800", marginBottom: 4 }}>Native Sentry Certification</Text>
        <Text style={{ color: "#64748B", marginBottom: 16 }}>
          EAS preview build only — not Expo Go
        </Text>

        <View style={{ backgroundColor: "white", borderRadius: 12, padding: 12, marginBottom: 16 }}>
          <Text style={{ fontSize: 16, fontWeight: "700", marginBottom: 8 }}>Device proof</Text>
          <Row label="Platform" value={Platform.OS} />
          <Row label="Device model" value={Constants.deviceName ?? "unknown"} />
          <Row label="OS version" value={String(Platform.Version)} />
          <Row label="App version" value={Constants.expoConfig?.version ?? "unknown"} />
          <Row label="Build" value={buildVersion} />
          <Row label="Release" value={`homigo-mobile@${Constants.expoConfig?.version ?? "unknown"}`} />
          <Row label="Execution environment" value={Constants.executionEnvironment} />
        </View>

        <View style={{ backgroundColor: "white", borderRadius: 12, padding: 12, marginBottom: 16 }}>
          <Text style={{ fontSize: 16, fontWeight: "700", marginBottom: 8 }}>Auth context</Text>
          <Row label="Status" value={authStatus} />
          <Row label="User ID" value={userId ?? "—"} />
        </View>

        <View style={{ backgroundColor: "white", borderRadius: 12, padding: 12, marginBottom: 16 }}>
          <Text style={{ fontSize: 16, fontWeight: "700", marginBottom: 8 }}>Startup breadcrumbs</Text>
          {timeline.length === 0 ? (
            <Text style={{ color: "#64748B", fontSize: 13 }}>No startup markers recorded</Text>
          ) : (
            timeline.map((e) => (
              <Row
                key={`${e.marker}-${e.at}`}
                label={e.marker}
                value={`+${e.sinceStartMs}ms${e.detail ? ` (${e.detail})` : ""}`}
              />
            ))
          )}
        </View>

        <View style={{ backgroundColor: "white", borderRadius: 12, padding: 12, marginBottom: 16 }}>
          <Text style={{ fontSize: 16, fontWeight: "700", marginBottom: 8 }}>Certification actions</Text>
          <Text style={{ color: "#64748B", fontSize: 12, marginBottom: 12 }}>
            1. Log in with a real account. 2. Cold-start the app. 3. Send JS test. 4. Trigger native crash.
          </Text>
          <Pressable
            onPress={() => setJsResult(triggerSentryTestException())}
            style={{ backgroundColor: "#2563EB", padding: 12, borderRadius: 8, alignItems: "center", marginBottom: 8 }}
          >
            <Text style={{ color: "white", fontWeight: "600" }}>Send JS test exception</Text>
          </Pressable>
          {jsResult && <Text style={{ fontSize: 12, color: "#475569", marginBottom: 8 }}>{jsResult}</Text>}
          <Pressable
            onPress={() => setNativeResult(triggerSentryNativeCrash())}
            style={{ backgroundColor: "#B91C1C", padding: 12, borderRadius: 8, alignItems: "center" }}
          >
            <Text style={{ color: "white", fontWeight: "600" }}>Trigger native crash</Text>
          </Pressable>
          {nativeResult && <Text style={{ fontSize: 12, color: "#475569", marginTop: 8 }}>{nativeResult}</Text>}
        </View>
      </ScrollView>
    </>
  );
}
