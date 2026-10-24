jest.unmock('react-native');
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { MacroTargetsSection } from './MacroTargetsSection';

it('saves the energy shown after a macro edit and restores it on reopen', async () => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  const initial = { protein: '40', carbs: '65', fat: '20', calories: '600' };
  const screen = render(<MacroTargetsSection targets={initial} onSave={onSave} onSetupPress={jest.fn()} />);
  fireEvent.press(screen.getByLabelText('Edit daily macros'));
  fireEvent.changeText(screen.getByLabelText('Protein target'), '50');
  expect(screen.getByText('640 kcal')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Save daily macros'));
  await waitFor(() => expect(onSave).toHaveBeenCalledWith({ ...initial, protein: '50', calories: '640' }));
  screen.rerender(<MacroTargetsSection targets={onSave.mock.calls[0][0]} onSave={onSave} onSetupPress={jest.fn()} />);
  expect(screen.getByText('640 kcal')).toBeTruthy();
});

it('does not save a temporarily empty macro as a valid target', async () => {
  const onSave = jest.fn().mockResolvedValue(undefined);
  const screen = render(<MacroTargetsSection targets={{ protein: '40', carbs: '65', fat: '20', calories: '600' }}
    onSave={onSave} onSetupPress={jest.fn()} />);
  fireEvent.press(screen.getByLabelText('Edit daily macros'));
  fireEvent.changeText(screen.getByLabelText('Protein target'), '');
  expect(screen.getByText('-- kcal')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('Save daily macros'));
  expect(onSave).not.toHaveBeenCalled();
  expect(screen.getByText('Enter protein, carbs and fat before saving.')).toBeTruthy();
});
