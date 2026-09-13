import { reconcileMenuBookmarks } from './menuBookmarks';

test('a failed saved-list read preserves the bookmark already shown before Retry', () => {
  const previous = new Map([['pasta', 'saved-pasta']]);
  expect(reconcileMenuBookmarks(previous, null).get('pasta')).toBe('saved-pasta');
});

test('a successful empty list removes a bookmark deleted elsewhere', () => {
  const previous = new Map([['pasta', 'saved-pasta']]);
  expect(reconcileMenuBookmarks(previous, new Map()).has('pasta')).toBe(false);
});

test('a confirmed purchase save appears even when the saved-list request failed', () => {
  const previous = new Map([['soup', 'saved-soup']]);
  const next = reconcileMenuBookmarks(previous, null, { menuItemId: 'pasta', id: 'saved-pasta' });
  expect([...next]).toEqual([['soup', 'saved-soup'], ['pasta', 'saved-pasta']]);
  expect(previous.has('pasta')).toBe(false);
});

test('a successful fetch replaces stale state and retains a newly confirmed save', () => {
  const previous = new Map([['old-meal', 'old-save']]);
  const fetched = new Map([['soup', 'saved-soup']]);
  const next = reconcileMenuBookmarks(previous, fetched, { menuItemId: 'pasta', id: 'saved-pasta' });
  expect([...next]).toEqual([['soup', 'saved-soup'], ['pasta', 'saved-pasta']]);
  expect(fetched.has('pasta')).toBe(false);
});
