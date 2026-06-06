/**
 * Decide whether the search screen should show the full-screen brand loader.
 *
 * The full-screen loader *replaces* the results list — and the search bar lives
 * in that list's header. So showing it while the user is typing unmounts the
 * TextInput, drops focus, and dismisses the keyboard. The rule: only show the
 * full-screen loader on the very first load, before any query interaction and
 * before there's anything to display. Once a query is active, the list (and its
 * search bar) must stay mounted; loading is reflected without unmounting.
 */
export function shouldShowInitialLoader(opts: {
  loading: boolean;
  resultCount: number;
  hasQuery: boolean;
}): boolean {
  return opts.loading && opts.resultCount === 0 && !opts.hasQuery;
}
