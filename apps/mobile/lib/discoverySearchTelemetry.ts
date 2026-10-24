import type { LocationState } from './useLocation';
import type { discoveryTargetFlags } from './discoverySearchParams';
import { recordSearchAndMaybePrompt } from './ratingPrompt';
import { trackSearchEmptyResults, trackSearchPageLoaded, trackSearchPaginationEndReached, trackSearchPerformed } from './analytics';

/** Only record a settled first page, never cancelled or stale responses. */
export function recordFirstDiscoveryPage(count: number, cursor: string | null, locked: boolean,
  targets: ReturnType<typeof discoveryTargetFlags>, query: string, source: LocationState['source']) {
  trackSearchPageLoaded({ page_index: 0, result_count: count, cursor: null });
  if (cursor === null) trackSearchPaginationEndReached({ total_results: count, pages_loaded: 1 });
  trackSearchPerformed({ ...targets, cuisine_filter: 'all', query_length: query.trim().length,
    result_count: count, location_source: source, success: true });
  if (!count) trackSearchEmptyResults({ cuisine_filter: 'all', ...targets });
  else if (!locked) void recordSearchAndMaybePrompt();
}
