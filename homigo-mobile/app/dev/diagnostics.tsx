import React, { useCallback, useEffect, useState } from "react";
import { ScrollView, Text, View, Pressable, Platform, Share } from "react-native";
import { Redirect, Stack } from "expo-router";
import Constants from "expo-constants";
import * as Clipboard from "expo-clipboard";
import { useConnectivityStore } from "@/lib/connectivity/connectivity-service";
import { useAuthStore } from "@/stores/auth-store";
import {
  collectRuntimeDiagnostics,
  exportDiagnosticsJson,
  startFpsMonitor,
  getFpsSnapshot,
  type RuntimeDiagnosticsBundle,
} from "@/lib/diagnostics/runtime-diagnostics";
import { triggerSentryTestException } from "@/lib/observability/sentry";
import { getActiveNetInfoSubscriptionCount } from "@/lib/connectivity/connectivity-service";
import { getStartupTimeline, checkStartupBudgets } from "@/lib/startup-trace";

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: "#E2E8F0" }}>
      <Text style={{ color: "#64748B", fontSize: 13, flex: 1 }}>{label}</Text>
      <Text style={{ color: "#0F172A", fontSize: 13, fontWeight: "600", flex: 1.2, textAlign: "right" }}>{value}</Text>
    </View>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 20 }}>
      <Text style={{ fontSize: 16, fontWeight: "700", color: "#0F172A", marginBottom: 8 }}>{title}</Text>
      <View style={{ backgroundColor: "white", borderRadius: 12, padding: 12 }}>{children}</View>
    </View>
  );
}

export default function DevDiagnosticsScreen() {
  if (!__DEV__) return <Redirect href="/(tabs)" />;

  const connectivity = useConnectivityStore();
  const authStatus = useAuthStore((s) => s.status);
  const userId = useAuthStore((s) => s.user?.id);
  const [bundle, setBundle] = useState<RuntimeDiagnosticsBundle | null>(null);
  const [fps, setFps] = useState(getFpsSnapshot());
  const [sentryResult, setSentryResult] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void collectRuntimeDiagnostics().then(setBundle);
    setFps(getFpsSnapshot());
  }, []);

  useEffect(() => {
    const stopFps = startFpsMonitor();
    refresh();
    const interval = setInterval(() => {
      setFps(getFpsSnapshot());
    }, 1000);
    return () => {
      stopFps();
      clearInterval(interval);
    };
  }, [refresh]);

  const timeline = getStartupTimeline();
  const budgets = checkStartupBudgets();

  const buildVersion =
    Platform.OS === "ios"
      ? Constants.expoConfig?.ios?.buildNumber ?? "?"
      : String(Constants.expoConfig?.android?.versionCode ?? "?");

  const deviceTypeLabel =
    Platform.OS === "android"
      ? "android"
      : Platform.OS === "ios"
        ? (Platform as { isPad?: boolean }).isPad
          ? "ipad"
          : "iphone"
        : Platform.OS;

  const exportBundle = async (mode: "clipboard" | "share") => {
    const json = await exportDiagnosticsJson();
    if (mode === "clipboard") {
      await Clipboard.setStringAsync(json);
      setExportStatus(`Copied ${json.length} bytes to clipboard`);
    } else {
      await Share.share({ message: json, title: "HOMIGO diagnostics" });
      setExportStatus(`Shared ${json.length} bytes`);
    }
  };

  return (
    <>
      <Stack.Screen options={{ title: "Device Diagnostics", headerShown: true }} />
      <ScrollView style={{ flex: 1, backgroundColor: "#F1F5F9" }} contentContainerStyle={{ padding: 16 }}>
        <Text style={{ fontSize: 22, fontWeight: "800", marginBottom: 4 }}>HOMIGO Diagnostics</Text>
        <Text style={{ color: "#64748B", marginBottom: 16 }}>Development builds only</Text>

        <Section title="Version & Device">
          <Row label="App version" value={Constants.expoConfig?.version ?? "unknown"} />
          <Row label="Build" value={buildVersion} />
          <Row label="Platform" value={Platform.OS} />
          <Row label="Device type" value={deviceTypeLabel} />
        </Section>

        <Section title="Performance">
          <Row label="FPS (current)" value={fps.current.toFixed(1)} />
          <Row label="FPS (avg)" value={fps.avg.toFixed(1)} />
          <Row label="JS heap" value={bundle?.memory.jsHeapMb != null ? `${bundle.memory.jsHeapMb} MB` : "n/a"} />
          <Row label="CPU" value={bundle?.cpu.note ?? "…"} />
        </Section>

        <Section title="Startup metrics">
          {timeline.map((e) => (
            <Row key={`${e.marker}-${e.at}`} label={e.marker} value={`+${e.sinceStartMs}ms${e.detail ? ` (${e.detail})` : ""}`} />
          ))}
          {budgets.length > 0 && (
            <Text style={{ color: "#B91C1C", marginTop: 8, fontSize: 12 }}>
              Budget violations: {budgets.map((v) => v.name).join(", ")}
            </Text>
          )}
        </Section>

        <Section title="Network">
          <Row label="Connected" value={connectivity.isConnected ? "yes" : "no"} />
          <Row label="Reachable" value={String(connectivity.isInternetReachable ?? "unknown")} />
          <Row label="Type" value={connectivity.type} />
          <Row label="RUM label" value={connectivity.networkLabel} />
          <Row label="NetInfo subscriptions" value={String(getActiveNetInfoSubscriptionCount())} />
        </Section>

        <Section title="Auth">
          <Row label="Status" value={authStatus} />
          <Row label="User ID" value={userId ?? "—"} />
        </Section>

        <Section title="Queues">
          <Row label="Offline mutations" value={String(bundle?.offlineMutationQueue.count ?? "…")} />
          <Row label="Telemetry pending" value={String(bundle?.telemetryQueue.pending ?? "…")} />
        </Section>

        <Section title="WebSockets">
          {(bundle?.websockets ?? []).length === 0 ? (
            <Text style={{ color: "#64748B", fontSize: 13 }}>No active channels</Text>
          ) : (
            bundle?.websockets.map((ws) => (
              <Row
                key={ws.label}
                label={ws.label}
                value={`${ws.connected ? "connected" : ws.reconnecting ? "reconnecting" : "disconnected"}${ws.offline ? " (offline)" : ""}`}
              />
            ))
          )}
        </Section>

        <Section title="Export diagnostics bundle">
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Pressable onPress={() => void exportBundle("clipboard")} style={{ flex: 1, backgroundColor: "#2563EB", padding: 12, borderRadius: 8, alignItems: "center" }}>
              <Text style={{ color: "white", fontWeight: "600" }}>Copy JSON</Text>
            </Pressable>
            <Pressable onPress={() => void exportBundle("share")} style={{ flex: 1, backgroundColor: "#0F172A", padding: 12, borderRadius: 8, alignItems: "center" }}>
              <Text style={{ color: "white", fontWeight: "600" }}>Share</Text>
            </Pressable>
          </View>
          {exportStatus && <Text style={{ marginTop: 8, fontSize: 12, color: "#475569" }}>{exportStatus}</Text>}
          <Pressable onPress={refresh} style={{ marginTop: 8 }}>
            <Text style={{ color: "#2563EB", fontWeight: "600" }}>Refresh</Text>
          </Pressable>
        </Section>

        <Section title="Sentry">
          <Pressable
            onPress={() => setSentryResult(triggerSentryTestException())}
            style={{ backgroundColor: "#2563EB", padding: 12, borderRadius: 8, alignItems: "center" }}
          >
            <Text style={{ color: "white", fontWeight: "600" }}>Trigger test exception</Text>
          </Pressable>
          {sentryResult && <Text style={{ marginTop: 8, fontSize: 12, color: "#475569" }}>{sentryResult}</Text>}
        </Section>
      </ScrollView>
    </>
  );
}
