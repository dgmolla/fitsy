jest.unmock('react-native');

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { PreviewTourButton } from './PreviewTourButton';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

// #761: unmounting the help button while results load re-wrapped the guide copy
// and moved the search field 13pt under a tap. The slot must keep its width.
it('keeps the same 44pt slot whether or not the tour can start', () => {
  const onPress = jest.fn();
  const idle = render(<PreviewTourButton ready={false} onPress={onPress} />);
  const slot = StyleSheet.flatten(idle.getByTestId('preview-show-tour-slot', { includeHiddenElements: true }).props.style);
  expect(idle.queryByTestId('preview-show-tour')).toBeNull();
  const ready = render(<PreviewTourButton ready onPress={onPress} />);
  const button = ready.getByTestId('preview-show-tour');
  expect(StyleSheet.flatten(button.props.style)).toMatchObject({ width: slot.width, minHeight: slot.minHeight });
  expect(slot).toMatchObject({ width: 44, minHeight: 44 });
  fireEvent.press(button);
  expect(onPress).toHaveBeenCalledTimes(1);
});
