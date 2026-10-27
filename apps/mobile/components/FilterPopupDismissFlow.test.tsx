jest.unmock('react-native');
import React from 'react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { act, fireEvent, render } from '@testing-library/react-native';
import { FilterPopup } from './FilterPopup';

type Command = {
  runFlow?: string;
  tapOn?: { id: string; point?: string };
  assertVisible?: { id: string };
  extendedWaitUntil?: { notVisible: { id: string }; timeout: number };
};
const { loadAll } = require('js-yaml') as { loadAll(text: string): unknown[] };
const load = (path: string) => loadAll(readFileSync(path, 'utf8'))[1] as Command[];
const target = { calories: '280', protein: '28', carbs: '34', fat: '5' };

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it.each(['shuffle', 'meal-target-energy-sync'])('%s dismisses through exposed backdrop instead of the covered screen center', flow => {
  const directory = resolve(__dirname, '../e2e/flows');
  const commands = load(resolve(directory, `${flow}.yaml`));
  const dismissal = commands.find(command => command.tapOn?.id === 'meal-filter-close'
    || command.runFlow === '../helpers/dismiss-meal-targets.yaml');
  expect(dismissal).toBeDefined();
  const steps = dismissal?.runFlow ? load(resolve(directory, dismissal.runFlow)) : [dismissal!];
  const tap = steps.find(command => command.tapOn)?.tapOn;
  expect(tap?.id).toBe('meal-filter-close');

  // Native hit testing is absent from React test-renderer. These XCTest bounds
  // reproduce the failed iPhone 15 capture: the full-screen backdrop's center
  // (196.5, 426) is covered by the card and its Decrease Carbs control.
  const backdrop = { width: 393, height: 852 };
  const card = { left: 20, right: 373, top: 215, bottom: 637 };
  const percentages = (tap?.point ?? '50%,50%').split(',').map(value => {
    expect(value).toMatch(/^\d+(?:\.\d+)?%$/);
    return Number.parseFloat(value) / 100;
  });
  const [x, y] = [percentages[0] * backdrop.width, percentages[1] * backdrop.height];
  expect(x).toBeGreaterThan(0);
  expect(x).toBeLessThan(backdrop.width);
  expect(y).toBeGreaterThan(0);
  expect(y).toBeLessThan(backdrop.height);
  expect(x >= card.left && x <= card.right && y >= card.top && y <= card.bottom).toBe(false);

  const onClose = jest.fn();
  const onApply = jest.fn();
  const screen = render(<FilterPopup visible values={target} onClose={onClose} onApply={onApply} />);
  act(() => { jest.runAllTimers(); });
  fireEvent.press(screen.getByTestId(tap!.id));
  act(() => { jest.runAllTimers(); });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onApply).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Carbs grams').props.value).toBe('34');
  expect(steps[0]).toEqual({ assertVisible: { id: 'meal-filter-close' } });
  expect(steps.at(-1)).toEqual({ extendedWaitUntil: {
    notVisible: { id: 'meal-filter-close' }, timeout: 5000,
  } });
});
