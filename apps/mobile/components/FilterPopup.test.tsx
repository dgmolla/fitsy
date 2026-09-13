jest.unmock('react-native');
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { FilterPopup } from './FilterPopup';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

it('preserves the entered calorie target when changing protein, and applies all four targets', () => {
  const onApply = jest.fn();
  const screen = render(<FilterPopup visible values={{ calories: '600', protein: '40', carbs: '60', fat: '20' }} onApply={onApply} onClose={jest.fn()} />);
  act(() => { jest.runAllTimers(); });
  expect(screen.getByLabelText('Calories per meal').props.value).toBe('600');
  fireEvent.press(screen.getByLabelText('Increase Protein'));
  expect(screen.getByLabelText('Calories per meal').props.value).toBe('600');
  fireEvent.changeText(screen.getByLabelText('Calories per meal'), '650');
  fireEvent.press(screen.getByLabelText('Apply meal targets'));
  act(() => { jest.runAllTimers(); });
  expect(onApply).toHaveBeenCalledWith({ calories: '650', protein: '45', carbs: '60', fat: '20' });
});

it('discards edits when dismissed without applying', () => {
  const onApply = jest.fn();
  const onClose = jest.fn();
  const values = { calories: '600', protein: '40', carbs: '60', fat: '20' };
  const screen = render(<FilterPopup visible values={values} onApply={onApply} onClose={onClose} />);
  act(() => { jest.runAllTimers(); });
  fireEvent.press(screen.getByLabelText('Increase Calories'));
  fireEvent.press(screen.getByLabelText('Close filters'));
  act(() => { jest.runAllTimers(); });
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onApply).not.toHaveBeenCalled();
  screen.rerender(<FilterPopup visible={false} values={values} onApply={onApply} onClose={onClose} />);
  screen.rerender(<FilterPopup visible values={values} onApply={onApply} onClose={onClose} />);
  act(() => { jest.runAllTimers(); });
  expect(screen.getByLabelText('Calories per meal').props.value).toBe('600');
});
