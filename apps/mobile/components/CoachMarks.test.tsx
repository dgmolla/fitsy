jest.unmock('react-native');

import React from 'react';
import { View } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { CoachMarks, type CoachMarkStep } from './CoachMarks';

jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 59, bottom: 34, left: 0, right: 0 }) }));
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
  it('keeps every numbered step when a search leaves no restaurant anchor', () => {
    const onDone = jest.fn();
    const onStepShown = jest.fn();
    const screen = render(<CoachMarks visible steps={steps} onDone={onDone} onStepShown={onStepShown} />);
    act(() => { jest.advanceTimersByTime(100); });
    expect(screen.getByText('1 of 3')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Next tip'));
    act(() => { jest.advanceTimersByTime(100); });
    expect(screen.getByText('Step B')).toBeTruthy();
    expect(screen.getByText('2 of 3')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Next tip'));
    act(() => { jest.advanceTimersByTime(100); });
    expect(screen.getByText('Step C')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Previous tip'));
    act(() => { jest.advanceTimersByTime(100); });
    expect(screen.getByText('Step B')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Next tip'));
    act(() => { jest.advanceTimersByTime(100); });
    fireEvent.press(screen.getByLabelText('Got it'));
    expect(onDone).toHaveBeenCalledTimes(1);
    expect(onStepShown.mock.calls.map(([step]) => step.key)).toEqual(['a', 'b', 'c', 'b', 'c']);
  });

  it('does not advance twice when Next is tapped before the next tip has laid out', () => {
    const screen = render(<CoachMarks visible steps={steps} onDone={jest.fn()} />);
    act(() => jest.advanceTimersByTime(100));
    const next = screen.getByLabelText('Next tip');
    act(() => { fireEvent.press(next); fireEvent.press(next); });
    act(() => jest.advanceTimersByTime(100));
    expect(screen.getByText('2 of 3')).toBeTruthy();
  });

  it('waits for scrolling before measuring, and replay starts at the first tip', async () => {
    let finishScroll: () => void = () => {};
    const onBeforeStep = jest.fn(() => new Promise<void>(resolve => { finishScroll = resolve; }));
    const props = { steps, onDone: jest.fn(), onBeforeStep };
    const screen = render(<CoachMarks visible {...props} />);
    act(() => { jest.advanceTimersByTime(100); });
    expect(screen.queryByText('Step A')).toBeNull();
    await act(async () => { finishScroll(); });
    expect(screen.getByText('Step A')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Next tip'));
    screen.rerender(<CoachMarks visible={false} {...props} />);
    screen.rerender(<CoachMarks visible {...props} />);
    act(() => { jest.advanceTimersByTime(100); });
    await act(async () => { finishScroll(); });
    expect(screen.getByText('1 of 3')).toBeTruthy();
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
