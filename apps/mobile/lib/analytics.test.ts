/**
 * @jest-environment node
 *
 * Tests for the S-221 reliability events. Each previously-silent
 * `catch(() => {})` swallowing an onboarding API failure now routes through a
 * named PostHog event — these tests pin the event names, prop shapes, and the
 * "logging never throws even if PostHog itself errors" contract that other
 * call sites depend on.
 */

const captureMock = jest.fn();

jest.mock('posthog-react-native', () => {
  return jest.fn().mockImplementation(() => ({
    capture: captureMock,
    identify: jest.fn(),
    reset: jest.fn(),
  }));
});

import {
  __resetForTesting,
  trackPreviewFetchFailed,
  trackSaveMacroTargetsFailed,
  trackStatsFetchFailed,
} from './analytics';

beforeEach(() => {
  captureMock.mockReset();
  __resetForTesting();
});

describe('trackStatsFetchFailed', () => {
  it('captures stats_fetch_failed with the error message', () => {
    trackStatsFetchFailed(new Error('boom'));
    expect(captureMock).toHaveBeenCalledWith('stats_fetch_failed', {
      error_message: 'boom',
    });
  });

  it('captures stats_fetch_failed without error_message when err is unknown shape', () => {
    trackStatsFetchFailed({ weird: true });
    expect(captureMock).toHaveBeenCalledWith('stats_fetch_failed', {});
  });

  it('does not throw when PostHog capture itself throws', () => {
    captureMock.mockImplementationOnce(() => {
      throw new Error('posthog dead');
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => trackStatsFetchFailed(new Error('upstream'))).not.toThrow();
    warn.mockRestore();
  });
});

describe('trackPreviewFetchFailed', () => {
  it('captures preview_fetch_failed with the error message', () => {
    trackPreviewFetchFailed(new Error('network'));
    expect(captureMock).toHaveBeenCalledWith('preview_fetch_failed', {
      error_message: 'network',
    });
  });

  it('accepts a string error', () => {
    trackPreviewFetchFailed('timeout');
    expect(captureMock).toHaveBeenCalledWith('preview_fetch_failed', {
      error_message: 'timeout',
    });
  });
});

describe('trackSaveMacroTargetsFailed', () => {
  it('captures save_macro_targets_failed with the error message', () => {
    trackSaveMacroTargetsFailed(new Error('quota'));
    expect(captureMock).toHaveBeenCalledWith('save_macro_targets_failed', {
      error_message: 'quota',
    });
  });

  it('does not throw when PostHog capture itself throws', () => {
    captureMock.mockImplementationOnce(() => {
      throw new Error('posthog dead');
    });
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(() => trackSaveMacroTargetsFailed(new Error('upstream'))).not.toThrow();
    warn.mockRestore();
  });
});
