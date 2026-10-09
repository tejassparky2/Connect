import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { Button, Field, Stars } from '@/components/ui';

test('Button fires onPress, and not when disabled or loading', async () => {
  const onPress = jest.fn();
  const { rerender } = await render(<Button testID="b" title="Send OTP" onPress={onPress} />);
  await fireEvent.press(screen.getByTestId('b'));
  expect(onPress).toHaveBeenCalledTimes(1);
  await rerender(<Button testID="b" title="Send OTP" onPress={onPress} disabled />);
  expect(screen.getByTestId('b')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('b'));
  await rerender(<Button testID="b" title="Send OTP" onPress={onPress} loading />);
  expect(screen.getByTestId('b')).toBeBusy();
  await fireEvent.press(screen.getByTestId('b'));
  expect(onPress).toHaveBeenCalledTimes(1);
  expect(screen.queryByText('Send OTP')).not.toBeOnTheScreen();
});

test('Field renders label, prefix and error', async () => {
  await render(<Field label="Mobile number" prefix="+91" error="Enter a valid number" value="" onChangeText={() => undefined} />);
  expect(screen.getByText('Mobile number')).toBeOnTheScreen();
  expect(screen.getByText('+91')).toBeOnTheScreen();
  expect(screen.getByText('Enter a valid number')).toBeOnTheScreen();
});

test('Stars reports the tapped rating', async () => {
  const onChange = jest.fn();
  await render(<Stars value={0} onChange={onChange} />);
  await fireEvent.press(screen.getByTestId('star-4'));
  expect(onChange).toHaveBeenCalledWith(4);
});
