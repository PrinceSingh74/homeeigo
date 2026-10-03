import React from "react";
import { Pressable, Text, View } from "react-native";
import { partnerColors } from "@/theme/colors";
import { reportError } from "@/lib/observability/sentry";

type Props = { children: React.ReactNode };
type State = { hasError: boolean; message?: string };

/**
 * App-root error boundary, mirroring the customer app's.
 *
 * Without one, an uncaught render error white-screens the whole partner app with no recovery and
 * no report — for a partner mid-job that means losing access to accept/en-route/arrive actions
 * with no way back except a force-quit. This renders a recoverable fallback and ships the crash
 * to Sentry when configured (a no-op when it isn't).
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: unknown): State {
    return { hasError: true, message: error instanceof Error ? error.message : String(error) };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string }): void {
    reportError(error, { componentStack: info?.componentStack ?? "" });
  }

  private reset = (): void => this.setState({ hasError: false, message: undefined });

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
          backgroundColor: partnerColors.cream,
        }}
      >
        <Text style={{ fontSize: 20, fontWeight: "700", color: partnerColors.text, marginBottom: 8 }}>
          Something went wrong
        </Text>
        <Text
          style={{
            fontSize: 14,
            color: partnerColors.textMuted,
            textAlign: "center",
            marginBottom: 20,
            lineHeight: 20,
          }}
        >
          The app hit an unexpected error. You can try again — your session and jobs are safe.
        </Text>
        <Pressable
          onPress={this.reset}
          style={{
            backgroundColor: partnerColors.primary,
            paddingHorizontal: 24,
            paddingVertical: 12,
            borderRadius: 12,
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "700" }}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}
