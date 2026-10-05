jest.unmock('react-native');
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { FilterPopup } from './FilterPopup';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const values = { calories: '600', protein: '40', carbs: '65', fat: '20' };
const field = (screen: ReturnType<typeof render>, name: string) => screen.getByLabelText(name).props.value as string;

it('synchronizes step edits in both directions and applies one coherent target', () => {
  const onApply = jest.fn();
  const screen = render(<FilterPopup visible values={values} mode="complete" allowPartial onApply={onApply} onClose={jest.fn()} />);
  act(() => { jest.runAllTimers(); });
  fireEvent.press(screen.getByLabelText('Increase Protein'));
  expect(field(screen, 'Calories per meal')).toBe('620');
  fireEvent.press(screen.getByLabelText('Increase Calories'));
  const protein = Number(field(screen, 'Protein grams'));
  const carbs = Number(field(screen, 'Carbs grams'));
  const fat = Number(field(screen, 'Fat grams'));
  expect(protein).toBeGreaterThan(45);
  expect(Number(field(screen, 'Calories per meal'))).toBe(protein * 4 + carbs * 4 + fat * 9);
  fireEvent.press(screen.getByLabelText('Apply meal targets'));
  act(() => { jest.runAllTimers(); });
  expect(onApply).toHaveBeenCalledWith({ protein: String(protein), carbs: String(carbs), fat: String(fat), calories: String(protein * 4 + carbs * 4 + fat * 9) }, 'complete');
});

it('keeps temporary empty text and partial search filters independent', () => {
  const onApply = jest.fn();
  const partial = { calories: '600', protein: '40', carbs: '', fat: '20' };
  const screen = render(<FilterPopup visible values={partial} onApply={onApply} onClose={jest.fn()} />);
  act(() => { jest.runAllTimers(); });
  fireEvent.changeText(screen.getByLabelText('Protein grams'), '');
  expect(field(screen, 'Calories per meal')).toBe('600');
  fireEvent.changeText(screen.getByLabelText('Protein grams'), '45');
  fireEvent(screen.getByLabelText('Protein grams'), 'blur');
  expect(field(screen, 'Calories per meal')).toBe('600');
  fireEvent.press(screen.getByLabelText('Apply meal targets'));
  act(() => { jest.runAllTimers(); });
  expect(onApply).toHaveBeenCalledWith({ ...partial, protein: '45' }, 'search');
});

it('keeps a cleared existing profile macro invalid through a calorie edit', () => {
  const onApply = jest.fn();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    const screen = render(<FilterPopup visible values={values} mode="complete"
      onApply={onApply} onClose={jest.fn()} />);
    act(() => { jest.runAllTimers(); });
    fireEvent.changeText(screen.getByLabelText('Protein grams'), '');
    fireEvent.changeText(screen.getByLabelText('Calories per meal'), '700');
    fireEvent(screen.getByLabelText('Calories per meal'), 'blur');
    expect(field(screen, 'Protein grams')).toBe('');
    fireEvent.press(screen.getByLabelText('Apply meal targets'));
    expect(alert).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  } finally { alert.mockRestore(); }
});

it('uses goal defaults for a new profile target with no allocation', () => {
  const onApply = jest.fn();
  const screen = render(<FilterPopup visible values={{ calories: '', protein: '', carbs: '', fat: '' }}
    mode="complete" goal="maintain" onApply={onApply} onClose={jest.fn()} />);
  act(() => { jest.runAllTimers(); });
  fireEvent.changeText(screen.getByLabelText('Calories per meal'), '600');
  fireEvent(screen.getByLabelText('Calories per meal'), 'blur');
  expect(Number(field(screen, 'Protein grams'))).toBeGreaterThan(0);
  fireEvent.press(screen.getByLabelText('Apply meal targets'));
  act(() => { jest.runAllTimers(); });
  expect(onApply).toHaveBeenCalledWith(expect.objectContaining({
    calories: field(screen, 'Calories per meal'),
  }), 'complete');
});

it('keeps all-positive independent search constraints when applied without edits', () => {
  const onApply = jest.fn();
  const independent = { calories: '600', protein: '40', carbs: '60', fat: '20' };
  const screen = render(<FilterPopup visible values={independent} mode="search" onApply={onApply} onClose={jest.fn()} />);
  act(() => { jest.runAllTimers(); });
  fireEvent.press(screen.getByLabelText('Apply meal targets'));
  act(() => { jest.runAllTimers(); });
  expect(onApply).toHaveBeenCalledWith(independent, 'search');
});

it('can explicitly link a filled search filter and then synchronize calorie edits', () => {
  const onApply = jest.fn();
  const screen = render(<FilterPopup visible values={{ calories: '600', protein: '40', carbs: '', fat: '20' }}
    mode="search" allowPartial onApply={onApply} onClose={jest.fn()} />);
  act(() => { jest.runAllTimers(); });
  fireEvent.changeText(screen.getByLabelText('Carbs grams'), '65');
  fireEvent.press(screen.getByLabelText('Link calories and macros'));
  fireEvent.press(screen.getByLabelText('Increase Calories'));
  const protein = Number(field(screen, 'Protein grams'));
  const carbs = Number(field(screen, 'Carbs grams'));
  const fat = Number(field(screen, 'Fat grams'));
  expect(Number(field(screen, 'Calories per meal'))).toBe(4 * protein + 4 * carbs + 9 * fat);
  fireEvent.press(screen.getByLabelText('Apply meal targets'));
  act(() => { jest.runAllTimers(); });
  expect(onApply).toHaveBeenCalledWith({ protein: String(protein), carbs: String(carbs),
    fat: String(fat), calories: String(4 * protein + 4 * carbs + 9 * fat) }, 'complete');
});

it('can unlink a complete target to retain independent calorie and gram constraints', () => {
  const onApply = jest.fn();
  const screen = render(<FilterPopup visible values={values} mode="complete" allowPartial
    onApply={onApply} onClose={jest.fn()} />);
  act(() => { jest.runAllTimers(); });
  fireEvent.press(screen.getByLabelText('Use independent filters'));
  fireEvent.changeText(screen.getByLabelText('Calories per meal'), '600');
  fireEvent.changeText(screen.getByLabelText('Carbs grams'), '60');
  fireEvent(screen.getByLabelText('Carbs grams'), 'blur');
  expect(field(screen, 'Calories per meal')).toBe('600');
  fireEvent.press(screen.getByLabelText('Apply meal targets'));
  act(() => { jest.runAllTimers(); });
  expect(onApply).toHaveBeenCalledWith({ ...values, carbs: '60' }, 'search');
});

it('keeps a complete zero-protein target linked through discovery edit and reopen', () => {
  const onApply = jest.fn();
  const zeroProtein = { calories: '440', protein: '0', carbs: '65', fat: '20' };
  const screen = render(<FilterPopup visible values={zeroProtein} mode="complete" allowPartial
    onApply={onApply} onClose={jest.fn()} />);
  act(() => { jest.runAllTimers(); });
  fireEvent.press(screen.getByLabelText('Increase Carbs'));
  expect(field(screen, 'Calories per meal')).toBe('460');
  fireEvent.press(screen.getByLabelText('Apply meal targets'));
  act(() => { jest.runAllTimers(); });
  expect(onApply).toHaveBeenCalledWith({ ...zeroProtein, carbs: '70', calories: '460' }, 'complete');
  screen.rerender(<FilterPopup visible={false} values={onApply.mock.calls[0][0]} mode="complete"
    allowPartial onApply={onApply} onClose={jest.fn()} />);
  screen.rerender(<FilterPopup visible values={onApply.mock.calls[0][0]} mode="complete"
    allowPartial onApply={onApply} onClose={jest.fn()} />);
  act(() => { jest.runAllTimers(); });
  expect(field(screen, 'Calories per meal')).toBe('460');
});

it('keeps three positive macros with calories intentionally empty in discovery', () => {
  const onApply = jest.fn();
  const partial = { calories: '600', protein: '40', carbs: '65', fat: '20' };
  const screen = render(<FilterPopup visible values={partial} mode="complete" allowPartial onApply={onApply} onClose={jest.fn()} />);
  act(() => { jest.runAllTimers(); });
  fireEvent.changeText(screen.getByLabelText('Calories per meal'), '');
  fireEvent(screen.getByLabelText('Calories per meal'), 'blur');
  fireEvent.changeText(screen.getByLabelText('Protein grams'), '45');
  fireEvent(screen.getByLabelText('Protein grams'), 'blur');
  expect(field(screen, 'Calories per meal')).toBe('');
  fireEvent.press(screen.getByLabelText('Apply meal targets'));
  act(() => { jest.runAllTimers(); });
  expect(onApply).toHaveBeenCalledWith({ ...partial, calories: '', protein: '45' }, 'search');
});

it('discards edits when dismissed without applying', () => {
  const onApply = jest.fn();
  const onClose = jest.fn();
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
  expect(field(screen, 'Calories per meal')).toBe('600');
});
