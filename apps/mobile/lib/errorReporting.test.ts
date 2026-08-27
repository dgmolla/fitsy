import {
  installGlobalErrorReporting,
  trackClientError,
  _resetForTests,
} from './errorReporting';

const capture = jest.fn();
const flush = jest.fn().mockResolvedValue(undefined);
jest.mock('./analytics', () => ({
  getPostHogClient: () => ({ capture, flush }),
}));

type GlobalHandler = (error: unknown, isFatal?: boolean) => void;

describe('trackClientError', () => {
  beforeEach(() => jest.clearAllMocks());

  it('captures a client_error event and flushes', () => {
    trackClientError({
      message: 'boom',
      stack: 'stack-trace',
      source: 'error_boundary',
      is_fatal: false,
    });
    expect(capture).toHaveBeenCalledWith(
      'client_error',
      expect.objectContaining({ message: 'boom', source: 'error_boundary' }),
    );
    expect(flush).toHaveBeenCalled();
  });

  it('truncates very long stacks', () => {
    trackClientError({
      message: 'boom',
      stack: 'x'.repeat(10_000),
      source: 'global_handler',
      is_fatal: true,
    });
    const props = capture.mock.calls[0]?.[1] as { stack: string };
    expect(props.stack.length).toBeLessThanOrEqual(4000);
  });
});

describe('installGlobalErrorReporting', () => {
  const g = globalThis as { ErrorUtils?: unknown };
  let originalErrorUtils: unknown;

  beforeEach(() => {
    jest.clearAllMocks();
    _resetForTests();
    originalErrorUtils = g.ErrorUtils;
  });

  afterEach(() => {
    g.ErrorUtils = originalErrorUtils;
  });

  it('wraps the existing handler: reports, then delegates', () => {
    const previous = jest.fn();
    let installed: GlobalHandler | undefined;
    g.ErrorUtils = {
      getGlobalHandler: () => previous,
      setGlobalHandler: (h: GlobalHandler) => {
        installed = h;
      },
    };

    installGlobalErrorReporting();
    expect(installed).toBeDefined();

    const err = new Error('fatal-crash');
    installed!(err, true);

    expect(capture).toHaveBeenCalledWith(
      'client_error',
      expect.objectContaining({
        message: 'fatal-crash',
        source: 'global_handler',
        is_fatal: true,
      }),
    );
    expect(previous).toHaveBeenCalledWith(err, true);
  });

  it('is a no-op without ErrorUtils and never installs twice', () => {
    delete g.ErrorUtils;
    expect(() => installGlobalErrorReporting()).not.toThrow();

    const setGlobalHandler = jest.fn();
    g.ErrorUtils = { getGlobalHandler: () => undefined, setGlobalHandler };
    // Already marked installed by the first call — must not re-install.
    installGlobalErrorReporting();
    expect(setGlobalHandler).not.toHaveBeenCalled();
  });
});
