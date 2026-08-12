import React from "react";
import { View, Text, Pressable } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { reportError } from "@/lib/observability/telemetry";

type Props = { children: React.ReactNode };
type State = { hasError: boolean; message?: string };

/**
 * App-root error boundary. A previously-uncaught render error white-screened the whole app with no
 * recovery and no report. Now it renders a recoverable fallback and ships the crash to telemetry/Sentry.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string }): void {
    void SplashScreen.hideAsync().catch(() => undefined);
    reportError(error, { componentStack: info?.componentStack ?? "" });
  }

  private reset = (): void => this.setState({ hasError: false, message: undefined });

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", padding: 24, backgroundColor: "#F8FAFC" }}>
        <Text style={{ fontSize: 20, fontWeight: "700", color: "#0F172A", marginBottom: 8 }}>Something went wrong</Text>
        <Text style={{ fontSize: 14, color: "#475569", textAlign: "center", marginBottom: 20 }}>
          The app hit an unexpected error. You can try again — your session is safe.
        </Text>
        <Pressable
          onPress={this.reset}
          style={{ backgroundColor: "#2563EB", paddingHorizontal: 24, paddingVertical: 12, borderRadius: 12 }}
        >
          <Text style={{ color: "white", fontWeight: "600" }}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}
