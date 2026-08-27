import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { EDITORIAL, FONTS } from '@/lib/brand';
import { trackClientError } from '@/lib/errorReporting';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
}

/**
 * Root error boundary: reports render-phase crashes to PostHog and shows a
 * branded recovery screen instead of a white screen. "Try again" clears the
 * boundary so React re-renders the tree — enough for transient failures
 * (a bad network payload, a race on reload) without restarting the app.
 */
export class AppErrorBoundary extends React.Component<Props, State> {
  override state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    trackClientError({
      message: error.message,
      stack: `${error.stack ?? ''}\ncomponent stack:${info.componentStack ?? ''}`,
      source: 'error_boundary',
      is_fatal: false,
    });
  }

  private readonly reset = (): void => {
    this.setState({ hasError: false });
  };

  override render(): React.ReactNode {
    if (!this.state.hasError) return this.props.children;
    return (
      <View style={styles.container}>
        <Text style={styles.logo}>
          fitsy<Text style={styles.logoDot}>.</Text>
        </Text>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.body}>
          That&apos;s on us, not you. Tap below to pick up where you left off.
        </Text>
        <Pressable
          accessibilityRole="button"
          style={({ pressed }) => [styles.button, pressed && styles.buttonPressed]}
          onPress={this.reset}
        >
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: EDITORIAL.cream,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  logo: {
    fontFamily: FONTS.frauncesDisplay,
    fontSize: 28,
    color: EDITORIAL.green,
    marginBottom: 24,
  },
  logoDot: {
    color: EDITORIAL.greenAccent,
  },
  title: {
    fontFamily: FONTS.frauncesDisplay,
    fontSize: 22,
    color: EDITORIAL.green,
    marginBottom: 12,
    textAlign: 'center',
  },
  body: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 15,
    lineHeight: 22,
    color: EDITORIAL.greenMid,
    textAlign: 'center',
    marginBottom: 28,
  },
  button: {
    backgroundColor: EDITORIAL.green,
    borderRadius: 999,
    paddingHorizontal: 28,
    paddingVertical: 14,
  },
  buttonPressed: {
    backgroundColor: EDITORIAL.greenMid,
  },
  buttonText: {
    fontFamily: FONTS.nunitoSans,
    fontSize: 16,
    color: EDITORIAL.cream,
  },
});
