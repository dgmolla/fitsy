import { shouldShowInitialLoader } from './searchLoading';

describe('shouldShowInitialLoader', () => {
  it('shows the full-screen loader on the initial load (loading, no results, no query)', () => {
    expect(
      shouldShowInitialLoader({ loading: true, resultCount: 0, hasQuery: false }),
    ).toBe(true);
  });

  // The regression: a debounced fetch while typing must NOT unmount the list,
  // because the search bar lives in the list header and would lose focus.
  it('never shows the full-screen loader while a query is active, even with zero results', () => {
    expect(
      shouldShowInitialLoader({ loading: true, resultCount: 0, hasQuery: true }),
    ).toBe(false);
    expect(
      shouldShowInitialLoader({ loading: true, resultCount: 5, hasQuery: true }),
    ).toBe(false);
  });

  it('does not show the loader once results are present (query-less refine keeps the list)', () => {
    expect(
      shouldShowInitialLoader({ loading: true, resultCount: 5, hasQuery: false }),
    ).toBe(false);
  });

  it('does not show the loader when not loading', () => {
    expect(
      shouldShowInitialLoader({ loading: false, resultCount: 0, hasQuery: false }),
    ).toBe(false);
  });
});
