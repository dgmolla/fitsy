jest.unmock('react-native');

import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { captureException } from '@sentry/react-native';
import { AppErrorBoundary } from './AppErrorBoundary';

jest.mock('@sentry/react-native', () => ({ captureException: jest.fn() }));
jest.mock('posthog-react-native');

test('a render crash reaches Sentry and the existing Try again action restores content', () => {
  const error = new Error('synthetic render failure');
  const expectedReactDiagnostic = jest.spyOn(console, 'error').mockImplementation(() => {});
  let failing = true;
  function Content() {
    if (failing) throw error;
    return <Text>Recovered content</Text>;
  }
  try {
    const screen = render(<AppErrorBoundary><Content /></AppErrorBoundary>);
    expect(screen.getByText('Something went wrong')).toBeTruthy();
    expect(captureException).toHaveBeenCalledWith(error);
    failing = false;
    fireEvent.press(screen.getByText('Try again'));
    expect(screen.getByText('Recovered content')).toBeTruthy();
  } finally {
    expectedReactDiagnostic.mockRestore();
  }
});
