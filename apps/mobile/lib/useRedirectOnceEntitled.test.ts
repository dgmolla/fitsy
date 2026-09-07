import { renderHook } from '@testing-library/react-native';
import { useRedirectOnceEntitled } from './useRedirectOnceEntitled';

type Props = { entitled: boolean | null; busy: boolean };

function setup(initial: Props) {
  const onEntitled = jest.fn();
  const hook = renderHook((p: Props) => useRedirectOnceEntitled({ ...p, onEntitled }), { initialProps: initial });
  return { ...hook, onEntitled };
}

describe('useRedirectOnceEntitled', () => {
  it.each([
    { entitled: null, busy: false },
    { entitled: false, busy: false },
    { entitled: true, busy: true },
  ])('does nothing for %j', ({ entitled, busy }) => {
    const { onEntitled } = setup({ entitled, busy });
    expect(onEntitled).not.toHaveBeenCalled();
  });

  it('fires once when entitled arrives, and never again', () => {
    const { onEntitled, rerender } = setup({ entitled: null, busy: false });
    rerender({ entitled: true, busy: false });
    expect(onEntitled).toHaveBeenCalledTimes(1);
    rerender({ entitled: true, busy: true });
    rerender({ entitled: true, busy: false });
    expect(onEntitled).toHaveBeenCalledTimes(1);
  });

  it('waits for the screen to stop being busy', () => {
    const { onEntitled, rerender } = setup({ entitled: true, busy: true });
    expect(onEntitled).not.toHaveBeenCalled();
    rerender({ entitled: true, busy: false });
    expect(onEntitled).toHaveBeenCalledTimes(1);
  });

  it('claim() lets the screen take the one redirect itself (no second navigation after busy clears)', () => {
    const { onEntitled, result, rerender } = setup({ entitled: false, busy: true });
    // The purchase path: claim, navigate, then entitled flips and busy clears.
    result.current.claim();
    rerender({ entitled: true, busy: true });
    rerender({ entitled: true, busy: false });
    expect(onEntitled).not.toHaveBeenCalled();
  });
});
