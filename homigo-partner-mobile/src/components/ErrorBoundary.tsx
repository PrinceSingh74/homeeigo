import { TriangleAlert } from "lucide-react-native";
import React from "react";
import { StyleSheet, View } from "react-native";
import { Button, T } from "@/components/ui";
import { reportError } from "@/lib/observability/sentry";
import { color, radius, space } from "@/theme/tokens";

type Props = { children: React.ReactNode };
type State = { hasError: boolean };

/**
 * The app-root error boundary.
 *
 * Without one, an uncaught render error white-screens the whole app with no way back except a
 * force-quit — for a partner mid-job that means losing the accept / arrive / complete actions. This
 * shows a screen they can recover from and sends the crash to Sentry when it is configured. The
 * error's own text is not shown: it is written for developers, not for the partner.
 */
export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: { componentStack?: string | null }): void {
    reportError(error, { componentStack: info?.componentStack ?? "" });
  }

  private reset = (): void => this.setState({ hasError: false });

  render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <View style={styles.root} testID="error-boundary">
        <View style={styles.icon}>
          <TriangleAlert color={color.marigold} size={30} />
        </View>
        <T kind="title" accessibilityRole="header" style={styles.center}>
          Something went wrong
        </T>
        <T kind="body" tone="slate" style={styles.center} accessibilityRole="alert">
          The app hit a problem on this screen. Your account and your jobs are safe on the server. Try again; if it keeps happening, close the app and open it again.
        </T>
        <Button label="Try again" onPress={this.reset} style={styles.action} testID="error-boundary-retry" />
      </View>
    );
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", padding: space.xxl, gap: space.md, backgroundColor: color.paper },
  icon: { width: 64, height: 64, borderRadius: radius.pill, backgroundColor: color.marigoldWash, alignItems: "center", justifyContent: "center" },
  center: { textAlign: "center" },
  action: { alignSelf: "stretch", marginTop: space.md },
});
