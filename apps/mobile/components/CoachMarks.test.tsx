jest.unmock('react-native');

import React from 'react';
import * as Native from 'react-native';
import { ScrollView, StyleSheet, View } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { CoachMarks, relativeToOverlay, type CoachMarkStep } from './CoachMarks';

let mockInsets = { top: 59, bottom: 34, left: 0, right: 0 };
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => mockInsets }));
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

beforeEach(() => {
  jest.useFakeTimers();
  mockInsets = { top: 59, bottom: 34, left: 0, right: 0 };
});
afterEach(() => { jest.useRealTimers(); jest.restoreAllMocks(); });

function attachOverlay(screen: ReturnType<typeof render>, overlayY = 0) {
  if (screen.queryByTestId('coachmark-overlay')) {
    const overlay = screen.UNSAFE_getAllByType(View).find(node => node.props.testID === 'coachmark-overlay')?.instance as View;
    overlay.measureInWindow = cb => cb(0, overlayY, 393, 852);
    fireEvent(screen.getByTestId('coachmark-overlay'), 'layout', { nativeEvent: { layout: { width: 393, height: 852 } } });
  }
}

function renderTour(element: React.ReactElement, overlayY = 0) {
  const screen = render(element);
  attachOverlay(screen, overlayY);
  return screen;
}

describe('CoachMarks', () => {
  it('keeps every numbered step when a search leaves no restaurant anchor', () => {
    const onDone = jest.fn();
    const onStepShown = jest.fn();
    const screen = renderTour(<CoachMarks visible steps={steps} onDone={onDone} onStepShown={onStepShown} />);
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
    const screen = renderTour(<CoachMarks visible steps={steps} onDone={jest.fn()} />);
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
    const screen = renderTour(<CoachMarks visible {...props} />);
    act(() => { jest.advanceTimersByTime(100); });
    expect(screen.queryByText('Step A')).toBeNull();
    await act(async () => { finishScroll(); });
    expect(screen.getByText('Step A')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Next tip'));
    screen.rerender(<CoachMarks visible={false} {...props} />);
    screen.rerender(<CoachMarks visible {...props} />);
    attachOverlay(screen);
    act(() => { jest.advanceTimersByTime(100); });
    await act(async () => { finishScroll(); });
    expect(screen.getByText('1 of 3')).toBeTruthy();
  });

  it('Skip ends the tour early', () => {
    const onDone = jest.fn();
    const { getByLabelText } = renderTour(<CoachMarks visible steps={steps} onDone={onDone} />);
    act(() => { jest.advanceTimersByTime(100); });
    fireEvent.press(getByLabelText('Skip tour'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('renders nothing when not visible', () => {
    const { queryByText } = render(<CoachMarks visible={false} steps={steps} onDone={jest.fn()} />);
    expect(queryByText('Step A')).toBeNull();
  });

  it('exposes the highlight beside its tooltip within the modal accessibility boundary', () => {
    const screen = renderTour(<CoachMarks visible steps={steps} onDone={jest.fn()} />);
    act(() => { jest.advanceTimersByTime(100); });
    expect(screen.getByTestId('coachmark-overlay').props.accessibilityViewIsModal).toBe(true);
    expect(screen.getByText('Step A')).toBeTruthy();
    expect(screen.getByLabelText('Next tip')).toBeTruthy();
    expect(screen.getByTestId('coachmark-ring')).toBeTruthy();
  });

  it('places a measured target in the overlay coordinate space', () => {
    expect(relativeToOverlay({ x: 16, y: 243, width: 361, height: 44 }, { x: 0, y: -30, width: 393, height: 852 }))
      .toEqual({ x: 16, y: 273, width: 361, height: 44 });
    const screen = renderTour(<CoachMarks visible steps={steps} onDone={jest.fn()} />, -30);
    act(() => jest.advanceTimersByTime(100));
    const ring = screen.getByTestId('coachmark-ring');
    expect(StyleSheet.flatten(ring.props.style)).toMatchObject({ top: 124 });
  });

  it('remeasures a target moved by results without restarting its lesson', async () => {
    const bounds: [number, number, number, number] = [10, 100, 50, 20];
    const onStepShown = jest.fn();
    const onBeforeStep = jest.fn(async () => {});
    const props = { steps: [{ ...steps[0], target: fakeTarget(bounds) }], onDone: jest.fn(),
      onStepShown, onBeforeStep, layoutVersion: 0 };
    const screen = renderTour(<CoachMarks visible {...props} />, -30);
    await act(async () => { jest.advanceTimersByTime(100); });
    const ringBounds = () => StyleSheet.flatten(screen.getByTestId('coachmark-ring').props.style);
    expect(ringBounds().top).toBe(124);
    expect(ringBounds().left + ringBounds().width / 2).toBe(35);
    expect(ringBounds().top + ringBounds().height / 2).toBe(140);

    bounds[1] += 6;
    screen.rerender(<CoachMarks visible {...props} layoutVersion={1} />);
    act(() => { jest.advanceTimersByTime(32); });
    expect(ringBounds().top).toBe(130);
    // Results move the field six points; its highlight must keep the same center.
    expect(ringBounds().left + ringBounds().width / 2).toBe(35);
    expect(ringBounds().top + ringBounds().height / 2).toBe(146);
    expect(onBeforeStep).toHaveBeenCalledTimes(1);
    expect(onStepShown).toHaveBeenCalledTimes(1);
    expect(screen.getByText('1 of 1')).toBeTruthy();
  });

  it.each([
    { device: 'SE', width: 375, height: 667, top: 20, bottom: 0 },
    { device: '15 Pro', width: 393, height: 852, top: 59, bottom: 34 },
  ])('keeps the Search highlight and tooltip aligned through loading on iPhone $device', async ({ width, height, top, bottom }) => {
    jest.spyOn(Native, 'useWindowDimensions').mockReturnValue({ width, height, scale: 3, fontScale: 1 });
    mockInsets = { top, bottom, left: 0, right: 0 };
    const bounds: [number, number, number, number] = [16, top + 200, width - 32, 46];
    const overlay: [number, number, number, number] = [3, -30, width, height];
    const onBeforeStep = jest.fn(async () => {});
    const onStepShown = jest.fn();
    const props = { steps: [{ ...steps[0], target: fakeTarget(bounds), nextDisabled: true }],
      onDone: jest.fn(), onBeforeStep, onStepShown };
    const screen = render(<CoachMarks visible {...props} />);
    const root = screen.UNSAFE_getAllByType(View).find(node => node.props.testID === 'coachmark-overlay')?.instance as View;
    root.measureInWindow = cb => cb(...overlay);
    fireEvent(screen.getByTestId('coachmark-overlay'), 'layout', { nativeEvent: { layout: { width, height } } });
    await act(async () => { jest.advanceTimersByTime(100); });
    const ringBounds = () => StyleSheet.flatten(screen.getByTestId('coachmark-ring').props.style);
    const assertGeometry = () => {
      expect(ringBounds()).toMatchObject({ left: bounds[0] - overlay[0] - 6, top: bounds[1] - overlay[1] - 6,
        width: bounds[2] + 12, height: bounds[3] + 12 });
      const bubble = StyleSheet.flatten(screen.UNSAFE_getByType(ScrollView).props.style);
      expect(bubble.top).toBe(ringBounds().top + ringBounds().height + 14);
      expect(bubble.left).toBeGreaterThanOrEqual(16);
      expect(bubble.left + bubble.width).toBeLessThanOrEqual(width - 16);
    };
    assertGeometry();
    fireEvent.press(screen.getByLabelText('Got it'));
    expect(props.onDone).not.toHaveBeenCalled();

    // The actual results transition adds the replay button and moves Search 6pt.
    bounds[1] += 6;
    screen.rerender(<CoachMarks visible {...props} steps={[{ ...props.steps[0], nextDisabled: false }]} layoutVersion={1} />);
    act(() => { jest.advanceTimersByTime(32); });
    assertGeometry();
    expect(onBeforeStep).toHaveBeenCalledTimes(1);
    expect(onStepShown).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByLabelText('Got it'));
    expect(props.onDone).toHaveBeenCalledTimes(1);
  });

  it('ignores a pending native measurement after moving to another tip', () => {
    const callbacks: Parameters<View['measureInWindow']>[0][] = [];
    const props = { steps: [steps[0], steps[2]], onDone: jest.fn() };
    const screen = renderTour(<CoachMarks visible {...props} />);
    act(() => { jest.advanceTimersByTime(100); });
    const target = props.steps[0].target.current as View;
    const measure = target.measureInWindow;
    target.measureInWindow = cb => { callbacks.push(cb); };
    screen.rerender(<CoachMarks visible {...props} layoutVersion={1} />);
    act(() => { jest.advanceTimersByTime(32); });
    expect(callbacks).toHaveLength(1);
    target.measureInWindow = measure;
    fireEvent.press(screen.getByLabelText('Next tip'));
    act(() => { jest.advanceTimersByTime(100); });
    act(() => { callbacks[0](10, 900, 50, 20); });
    expect(screen.getByText('Step C')).toBeTruthy();
    const ring = screen.getByTestId('coachmark-ring');
    expect(StyleSheet.flatten(ring.props.style)).toMatchObject({ top: 294, height: 212 });
  });

  it('recovers an unavailable anchor after layout without replaying the lesson', () => {
    const target = fakeTarget(null);
    const onStepShown = jest.fn();
    const props = { steps: [{ ...steps[0], target }], onDone: jest.fn(), onStepShown };
    const screen = renderTour(<CoachMarks visible {...props} />);
    act(() => { jest.advanceTimersByTime(100); });
    expect(screen.queryByTestId('coachmark-ring')).toBeNull();
    expect(screen.getByText('Step A')).toBeTruthy();
    target.current = fakeTarget([16, 240, 343, 46]).current;
    screen.rerender(<CoachMarks visible {...props} layoutVersion={1} />);
    act(() => { jest.advanceTimersByTime(32); });
    const ring = screen.getByTestId('coachmark-ring');
    expect(StyleSheet.flatten(ring.props.style)).toMatchObject({ left: 10, top: 234, width: 355, height: 58 });
    expect(onStepShown).toHaveBeenCalledTimes(1);
  });
});
