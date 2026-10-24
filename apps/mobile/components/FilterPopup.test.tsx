jest.unmock('react-native');
import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { FilterPopup } from './FilterPopup';

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

const values = { calories: '600', protein: '40', carbs: '65', fat: '20' };
const field = (screen: ReturnType<typeof render>, name: string) => screen.getByLabelText(name).props.value as string;

it.each([
  { protein: '0', carbs: '65', fat: '20', calories: '440' },
  { protein: '40', carbs: '0', fat: '20', calories: '340' },
  { protein: '40', carbs: '65', fat: '0', calories: '420' },
])('links a complete zero-macro allocation and preserves it on reopen: %j', async target => {
  const onApply = jest.fn();
  const screen = render(<FilterPopup visible values={target} mode="search" allowPartial onApply={onApply} onClose={jest.fn()} />);
  act(() => { jest.runAllTimers(); });
  fireEvent.press(screen.getByLabelText('Link calories and macros'));
  await act(async () => { fireEvent.press(screen.getByLabelText('Apply meal targets')); });
  expect(onApply).toHaveBeenLastCalledWith(target, 'complete');
  screen.rerender(<FilterPopup visible={false} values={target} mode="complete" allowPartial onApply={onApply} onClose={jest.fn()} />);
  screen.rerender(<FilterPopup visible values={target} mode="complete" allowPartial onApply={onApply} onClose={jest.fn()} />);
  expect(field(screen, 'Calories per meal')).toBe(target.calories);
  expect(field(screen, 'Protein grams')).toBe(target.protein);
});

it('does not offer linking for an allocation with no macro energy', () => {
  const screen = render(<FilterPopup visible values={{ calories: '440', protein: '0', carbs: '0', fat: '0' }}
    mode="search" allowPartial onApply={jest.fn()} onClose={jest.fn()} />);
  expect(screen.queryByLabelText('Link calories and macros')).toBeNull();
});

it('keeps the editor and intentional draft when durable saving fails', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  const close = jest.fn();
  const apply = jest.fn().mockRejectedValue(new Error('storage unavailable'));
  try {
    const screen = render(<FilterPopup visible values={values} mode="complete" onApply={apply} onClose={close} />);
    act(() => { jest.runAllTimers(); });
    fireEvent.press(screen.getByLabelText('Increase Protein'));
    await act(async () => { fireEvent.press(screen.getByLabelText('Apply meal targets')); });
    expect(alert).toHaveBeenCalledWith("Couldn't save targets", expect.any(String));
    expect(close).not.toHaveBeenCalled();
    expect(field(screen, 'Protein grams')).toBe('45');
    expect(field(screen, 'Calories per meal')).toBe('620');
    apply.mockResolvedValue(undefined);
    await act(async () => { fireEvent.press(screen.getByLabelText('Apply meal targets')); });
    expect(apply).toHaveBeenLastCalledWith({ ...values, protein: '45', calories: '620' }, 'complete');
  } finally { alert.mockRestore(); }
});

it('synchronizes step edits in both directions and applies one coherent target', async () => {
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
  await act(async () => { fireEvent.press(screen.getByLabelText('Apply meal targets')); });
  act(() => { jest.runAllTimers(); });
  expect(onApply).toHaveBeenCalledWith({ protein: String(protein), carbs: String(carbs), fat: String(fat), calories: String(protein * 4 + carbs * 4 + fat * 9) }, 'complete');
});

it('keeps temporary empty text and partial search filters independent', async () => {
  const onApply = jest.fn();
  const partial = { calories: '600', protein: '40', carbs: '', fat: '20' };
  const screen = render(<FilterPopup visible values={partial} onApply={onApply} onClose={jest.fn()} />);
  act(() => { jest.runAllTimers(); });
  fireEvent.changeText(screen.getByLabelText('Protein grams'), '');
  expect(field(screen, 'Calories per meal')).toBe('600');
  fireEvent.changeText(screen.getByLabelText('Protein grams'), '45');
  fireEvent(screen.getByLabelText('Protein grams'), 'blur');
  expect(field(screen, 'Calories per meal')).toBe('600');
  await act(async () => { fireEvent.press(screen.getByLabelText('Apply meal targets')); });
  act(() => { jest.runAllTimers(); });
  expect(onApply).toHaveBeenCalledWith({ ...partial, protein: '45' }, 'search');
});

it('keeps a cleared existing profile macro invalid through a calorie edit', async () => {
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
    await act(async () => { fireEvent.press(screen.getByLabelText('Apply meal targets')); });
    expect(alert).toHaveBeenCalled();
    expect(onApply).not.toHaveBeenCalled();
  } finally { alert.mockRestore(); }
});

it('uses goal defaults for a new profile target with no allocation', async () => {
  const onApply = jest.fn();
  const screen = render(<FilterPopup visible values={{ calories: '', protein: '', carbs: '', fat: '' }}
    mode="complete" goal="maintain" onApply={onApply} onClose={jest.fn()} />);
  act(() => { jest.runAllTimers(); });
  fireEvent.changeText(screen.getByLabelText('Calories per meal'), '600');
  fireEvent(screen.getByLabelText('Calories per meal'), 'blur');
  expect(Number(field(screen, 'Protein grams'))).toBeGreaterThan(0);
  await act(async () => { fireEvent.press(screen.getByLabelText('Apply meal targets')); });
  act(() => { jest.runAllTimers(); });
  expect(onApply).toHaveBeenCalledWith(expect.objectContaining({
    calories: field(screen, 'Calories per meal'),
  }), 'complete');
});

it('keeps all-positive independent search constraints when applied without edits', async () => {
  const onApply = jest.fn();
  const independent = { calories: '600', protein: '40', carbs: '60', fat: '20' };
  const screen = render(<FilterPopup visible values={independent} mode="search" onApply={onApply} onClose={jest.fn()} />);
  act(() => { jest.runAllTimers(); });
  await act(async () => { fireEvent.press(screen.getByLabelText('Apply meal targets')); });
  act(() => { jest.runAllTimers(); });
  expect(onApply).toHaveBeenCalledWith(independent, 'search');
});

it('can explicitly link a filled search filter and then synchronize calorie edits', async () => {
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
  await act(async () => { fireEvent.press(screen.getByLabelText('Apply meal targets')); });
  act(() => { jest.runAllTimers(); });
  expect(onApply).toHaveBeenCalledWith({ protein: String(protein), carbs: String(carbs),
    fat: String(fat), calories: String(4 * protein + 4 * carbs + 9 * fat) }, 'complete');
});

it('can unlink a complete target to retain independent calorie and gram constraints', async () => {
  const onApply = jest.fn();
  const screen = render(<FilterPopup visible values={values} mode="complete" allowPartial
    onApply={onApply} onClose={jest.fn()} />);
  act(() => { jest.runAllTimers(); });
  fireEvent.press(screen.getByLabelText('Use independent filters'));
  fireEvent.changeText(screen.getByLabelText('Calories per meal'), '600');
  fireEvent.changeText(screen.getByLabelText('Carbs grams'), '60');
  fireEvent(screen.getByLabelText('Carbs grams'), 'blur');
  expect(field(screen, 'Calories per meal')).toBe('600');
  await act(async () => { fireEvent.press(screen.getByLabelText('Apply meal targets')); });
  act(() => { jest.runAllTimers(); });
  expect(onApply).toHaveBeenCalledWith({ ...values, carbs: '60' }, 'search');
});

it('keeps a complete zero-protein target linked through discovery edit and reopen', async () => {
  const onApply = jest.fn();
  const zeroProtein = { calories: '440', protein: '0', carbs: '65', fat: '20' };
  const screen = render(<FilterPopup visible values={zeroProtein} mode="complete" allowPartial
    onApply={onApply} onClose={jest.fn()} />);
  act(() => { jest.runAllTimers(); });
  fireEvent.press(screen.getByLabelText('Increase Carbs'));
  expect(field(screen, 'Calories per meal')).toBe('460');
  await act(async () => { fireEvent.press(screen.getByLabelText('Apply meal targets')); });
  act(() => { jest.runAllTimers(); });
  expect(onApply).toHaveBeenCalledWith({ ...zeroProtein, carbs: '70', calories: '460' }, 'complete');
  screen.rerender(<FilterPopup visible={false} values={onApply.mock.calls[0][0]} mode="complete"
    allowPartial onApply={onApply} onClose={jest.fn()} />);
  screen.rerender(<FilterPopup visible values={onApply.mock.calls[0][0]} mode="complete"
    allowPartial onApply={onApply} onClose={jest.fn()} />);
  act(() => { jest.runAllTimers(); });
  expect(field(screen, 'Calories per meal')).toBe('460');
});

it('keeps three positive macros with calories intentionally empty in discovery', async () => {
  const onApply = jest.fn();
  const partial = { calories: '600', protein: '40', carbs: '65', fat: '20' };
  const screen = render(<FilterPopup visible values={partial} mode="complete" allowPartial onApply={onApply} onClose={jest.fn()} />);
  act(() => { jest.runAllTimers(); });
  fireEvent.changeText(screen.getByLabelText('Calories per meal'), '');
  fireEvent(screen.getByLabelText('Calories per meal'), 'blur');
  fireEvent.changeText(screen.getByLabelText('Protein grams'), '45');
  fireEvent(screen.getByLabelText('Protein grams'), 'blur');
  expect(field(screen, 'Calories per meal')).toBe('');
  await act(async () => { fireEvent.press(screen.getByLabelText('Apply meal targets')); });
  act(() => { jest.runAllTimers(); });
  expect(onApply).toHaveBeenCalledWith({ ...partial, calories: '', protein: '45' }, 'search');
});

it('discards edits when dismissed without applying', async () => {
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

it('preserves a cleared macro after generating the first profile allocation', () => {
  const screen = render(<FilterPopup visible values={{ calories: '', protein: '', carbs: '', fat: '' }}
    mode="complete" onApply={jest.fn()} onClose={jest.fn()} />);
  fireEvent.changeText(screen.getByLabelText('Calories per meal'), '600');
  fireEvent(screen.getByLabelText('Calories per meal'), 'blur');
  expect(Number(field(screen, 'Protein grams'))).toBeGreaterThan(0);
  fireEvent.changeText(screen.getByLabelText('Protein grams'), '');
  fireEvent.changeText(screen.getByLabelText('Calories per meal'), '700');
  fireEvent(screen.getByLabelText('Calories per meal'), 'blur');
  expect(field(screen, 'Protein grams')).toBe('');
});

it('derives an initially blank complete profile target from three macro entries', async () => {
  const onApply = jest.fn();
  const screen = render(<FilterPopup visible values={{ calories: '', protein: '', carbs: '', fat: '' }}
    mode="complete" onApply={onApply} onClose={jest.fn()} />);
  act(() => { jest.runAllTimers(); });
  for (const [label, value] of [['Protein grams', '40'], ['Carbs grams', '65'], ['Fat grams', '20']]) {
    fireEvent.changeText(screen.getByLabelText(label), value);
    fireEvent(screen.getByLabelText(label), 'blur');
  }
  expect(field(screen, 'Calories per meal')).toBe('600');
  await act(async () => { fireEvent.press(screen.getByLabelText('Apply meal targets')); });
  expect(onApply).toHaveBeenCalledWith({ calories: '600', protein: '40', carbs: '65', fat: '20' }, 'complete');
});

it('keeps intentionally cleared profile calories incomplete through macro edits and Apply', async () => {
  const onApply = jest.fn();
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    const screen = render(<FilterPopup visible values={values} mode="complete" onApply={onApply} onClose={jest.fn()} />);
    fireEvent.changeText(screen.getByLabelText('Calories per meal'), '');
    fireEvent(screen.getByLabelText('Calories per meal'), 'blur');
    fireEvent.changeText(screen.getByLabelText('Protein grams'), '50');
    fireEvent(screen.getByLabelText('Protein grams'), 'blur');
    fireEvent.press(screen.getByLabelText('Increase Carbs'));
    expect(field(screen, 'Calories per meal')).toBe('');
    expect(field(screen, 'Protein grams')).toBe('50');
    await act(async () => { fireEvent.press(screen.getByLabelText('Apply meal targets')); });
    expect(onApply).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith('Complete your target', expect.any(String));
    fireEvent.changeText(screen.getByLabelText('Calories per meal'), '700');
    fireEvent(screen.getByLabelText('Calories per meal'), 'blur');
    expect(Number(field(screen, 'Calories per meal'))).toBeGreaterThan(0);
    await act(async () => { fireEvent.press(screen.getByLabelText('Apply meal targets')); });
    expect(onApply).toHaveBeenCalledTimes(1);
  } finally { alert.mockRestore(); }
});
