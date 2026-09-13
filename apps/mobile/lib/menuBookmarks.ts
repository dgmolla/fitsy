type Bookmark = { menuItemId: string; id: string };

/** null means the saved-list request failed, not that the list is empty. */
export function reconcileMenuBookmarks(
  previous: Map<string, string>,
  fetched: Map<string, string> | null,
  confirmedSave?: Bookmark,
): Map<string, string> {
  const next = new Map(fetched ?? previous);
  if (confirmedSave) next.set(confirmedSave.menuItemId, confirmedSave.id);
  return next;
}
