jest.unmock('react-native');
import { useState } from 'react';
import { AccessibilityInfo } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { usePreviewSearchDemo } from '../lib/usePreviewSearchDemo';

let motionChanged: ((enabled: boolean) => void) | undefined;
const removeMotionListener = jest.fn();

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'clearImmediate', 'queueMicrotask'] });
  motionChanged = undefined;
  removeMotionListener.mockClear();
  jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(false);
  // Native has overloaded announcement and boolean event signatures.
  // This hook subscribes only to the boolean Reduce Motion platform event.
  const addListener = (event: string, callback: (enabled: boolean) => void) => {
    if (event === 'reduceMotionChanged') motionChanged = callback;
    return { remove: removeMotionListener };
  };
  jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(addListener as unknown as typeof AccessibilityInfo.addEventListener);
});
afterEach(() => { jest.clearAllTimers(); jest.useRealTimers(); jest.restoreAllMocks(); });

function useSearch(active: boolean) {
  const [query, setQuery] = useState('sushi');
  const demo = usePreviewSearchDemo(active, setQuery);
  return { query, ...demo };
}
async function advance(milliseconds: number) {
  await act(async () => { await jest.advanceTimersByTimeAsync(milliseconds); });
}

it('clears on start and replay, and types a full craving into the real query state', async () => {
  const { result, rerender } = renderHook(({ active }) => useSearch(active), { initialProps: { active: false } });
  expect(result.current.query).toBe('sushi');
  rerender({ active: true });
  expect(result.current.query).toBe('');
  await act(async () => {});
  act(() => result.current.showStep('search'));
  expect(result.current.typing).toBe(true);
  expect(result.current.query).toBe('');
  await advance(280);
  expect(result.current.query).toBe('p');
  await advance(140);
  expect(result.current.query).toBe('pi');
  await advance(420);
  expect(result.current.query).toBe('pizza');
  expect(result.current.typing).toBe(false);
  rerender({ active: false });
  expect(result.current.query).toBe('pizza');
  rerender({ active: true });
  expect(result.current.query).toBe('');
  act(() => result.current.showStep('search'));
  await advance(840);
  expect(result.current.query).toBe('pizza');
});

it.each(['cancel', 'another step', 'inactive'] as const)('stops typing after %s without a late query update', async action => {
  const { result, rerender } = renderHook(({ active }) => useSearch(active), { initialProps: { active: true } });
  await act(async () => {});
  act(() => result.current.showStep('search'));
  await advance(280);
  expect(result.current.query).toBe('p');
  if (action === 'cancel') act(() => result.current.cancel());
  if (action === 'another step') act(() => result.current.showStep('restaurant'));
  if (action === 'inactive') rerender({ active: false });
  expect(result.current.typing).toBe(false);
  await advance(2000);
  expect(result.current.query).toBe('p');
});

it('never overwrites a user edit and can restart when returning to the search step', async () => {
  const { result } = renderHook(() => useSearch(true));
  await act(async () => {});
  act(() => result.current.showStep('search'));
  await advance(420);
  expect(result.current.query).toBe('pi');
  act(() => result.current.editQuery('ramen'));
  await advance(2000);
  expect(result.current.query).toBe('ramen');
  expect(result.current.typing).toBe(false);
  act(() => result.current.showStep('search'));
  expect(result.current.query).toBe('');
  await advance(840);
  expect(result.current.query).toBe('pizza');
});

it('removes scheduled writes and the accessibility listener on unmount', async () => {
  const changeQuery = jest.fn();
  const { result, unmount } = renderHook(() => usePreviewSearchDemo(true, changeQuery));
  await act(async () => {});
  act(() => result.current.showStep('search'));
  await advance(280);
  expect(changeQuery).toHaveBeenLastCalledWith('p');
  changeQuery.mockClear();
  unmount();
  await advance(2000);
  expect(changeQuery).not.toHaveBeenCalled();
  expect(removeMotionListener).toHaveBeenCalledTimes(1);
});

it('shows the complete craving immediately when reduced motion is enabled', async () => {
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockResolvedValue(true);
  const { result } = renderHook(() => useSearch(true));
  await act(async () => {});
  expect(result.current.query).toBe('');
  act(() => result.current.showStep('search'));
  expect(result.current.query).toBe('pizza');
  expect(result.current.typing).toBe(false);
  await advance(2000);
  expect(result.current.query).toBe('pizza');
});

it('stops the typewriter immediately if reduced motion is enabled during the story', async () => {
  const { result } = renderHook(() => useSearch(true));
  await act(async () => {});
  act(() => result.current.showStep('search'));
  await advance(280);
  expect(result.current.query).toBe('p');
  act(() => motionChanged?.(true));
  expect(result.current.query).toBe('pizza');
  expect(result.current.typing).toBe(false);
  await advance(2000);
  expect(result.current.query).toBe('pizza');
});

it('does not start late when accessibility settings resolve after the tour was skipped', async () => {
  let resolveMotion!: (value: boolean) => void;
  jest.mocked(AccessibilityInfo.isReduceMotionEnabled).mockReturnValue(new Promise(resolve => { resolveMotion = resolve; }));
  const { result } = renderHook(() => useSearch(true));
  act(() => result.current.showStep('search'));
  act(() => result.current.cancel());
  act(() => result.current.editQuery('tacos'));
  await act(async () => { resolveMotion(false); });
  await advance(2000);
  expect(result.current.query).toBe('tacos');
  expect(result.current.typing).toBe(false);
});

it('finishes typing when the visible search step is remeasured mid-animation', async () => {
  const { result } = renderHook(() => useSearch(true));
  await act(async () => {});
  act(() => result.current.showStep('search'));
  await advance(420);
  expect(result.current.query).toBe('pi');
  act(() => result.current.showStep('search'));
  await advance(2000);
  expect(result.current.query).toBe('pizza');
  expect(result.current.typing).toBe(false);
});
