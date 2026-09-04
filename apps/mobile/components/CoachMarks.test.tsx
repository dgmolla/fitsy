import React from 'react';
import { View } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { CoachMarks, type CoachMarkStep } from './CoachMarks';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

function fakeTarget(rect: [number, number, number, number] | null) {
  return {
    current: rect
      ? ({ measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => cb(...rect) } as unknown as View)
      : null,
  };
}

const steps: CoachMarkStep[] = [
  { key: 'a', title: 'Step A', body: 'Body A', target: fakeTarget([10, 100, 50, 20]) },
  { key: 'b', title: 'Step B', body: 'Body B', target: fakeTarget(null) },
  { key: 'c', title: 'Step C', body: 'Body C', target: fakeTarget([10, 300, 300, 200]), placement: 'above' },
];

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('CoachMarks', () => {
  it('walks the steps with Next, skips an unmounted target, and finishes with Got it', () => {
    const onDone = jest.fn();
    const onStepShown = jest.fn();
    const { getByText, queryByText, getByLabelText } = render(
      <CoachMarks visible steps={steps} onDone={onDone} onStepShown={onStepShown} />,
    );
    act(() => { jest.advanceTimersByTime(100); });
    expect(getByText('Step A')).toBeTruthy();
    expect(getByText('1 of 3')).toBeTruthy();

    fireEvent.press(getByLabelText('Next tip'));
    // Step B's target is not mounted: it is skipped straight to C.
    act(() => { jest.advanceTimersByTime(100); });
    act(() => { jest.advanceTimersByTime(100); });
    expect(queryByText('Step B')).toBeNull();
    expect(getByText('Step C')).toBeTruthy();
    expect(onStepShown).toHaveBeenCalledTimes(2);

    fireEvent.press(getByLabelText('Got it'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('Skip ends the tour early', () => {
    const onDone = jest.fn();
    const { getByLabelText } = render(<CoachMarks visible steps={steps} onDone={onDone} />);
    act(() => { jest.advanceTimersByTime(100); });
    fireEvent.press(getByLabelText('Skip tour'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when not visible', () => {
    const { queryByText } = render(<CoachMarks visible={false} steps={steps} onDone={jest.fn()} />);
    expect(queryByText('Step A')).toBeNull();
  });
});
