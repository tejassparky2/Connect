import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { router, useLocalSearchParams } from 'expo-router';
import { useAuth } from '@/lib/auth';
import { mockFetch, withQuery } from './testUtils';
import PhoneScreen from '@/app/(auth)/phone';
import OtpScreen from '@/app/(auth)/otp';
import { AddressForm } from '@/components/AddressForm';
import CreatePost from '@/app/post/create';
import Verify from '@/app/verify';

const ME = { id: 'u1', phone: '+919876543210', name: 'Asha', verificationLevel: 'LOCATION', feedRadiusM: 3000, hasHome: true, address: null, neighborhood: null, societies: [], businesses: [] };

beforeEach(() => {
  jest.clearAllMocks();
  (useLocalSearchParams as jest.Mock).mockReturnValue({});
});

test('phone screen validates Indian numbers and requests an OTP', async () => {
  const calls = mockFetch([{ method: 'POST', path: '/v1/auth/otp/request', body: { phone: '+919876543210', devCode: '123456' } }]);
  await render(withQuery(<PhoneScreen />).ui);
  await fireEvent.changeText(screen.getByTestId('phone-input'), '12345 67890');
  await fireEvent.press(screen.getByTestId('send-otp'));
  expect(await screen.findByText('Enter a valid 10-digit mobile number')).toBeOnTheScreen();
  expect(calls).toHaveLength(0);

  await fireEvent.changeText(screen.getByTestId('phone-input'), '98765 43210');
  await fireEvent.press(screen.getByTestId('send-otp'));
  await waitFor(() => expect(router.push).toHaveBeenCalledWith({ pathname: '/otp', params: { phone: '+919876543210', devCode: '123456' } }));
  expect(calls[0].body).toEqual({ phone: '+919876543210' });
});

test('OTP screen auto-verifies on the 6th digit and persists tokens in SecureStore', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ phone: '+919876543210', devCode: '' });
  const calls = mockFetch([{ method: 'POST', path: '/v1/auth/otp/verify', body: { accessToken: 'acc', refreshToken: 'ref', user: ME } }]);
  await render(withQuery(<OtpScreen />).ui);
  await fireEvent.changeText(screen.getByTestId('otp-input'), '12a3456'); // non-digits stripped
  await waitFor(() => expect(useAuth.getState().status).toBe('signedIn'));
  expect(calls[0].body).toEqual({ phone: '+919876543210', code: '123456' });
  expect(await SecureStore.getItemAsync('mc.refresh')).toBe('ref');
  expect(useAuth.getState().me?.name).toBe('Asha');
});

test('OTP screen shows the server error and clears the code on a wrong OTP', async () => {
  (useLocalSearchParams as jest.Mock).mockReturnValue({ phone: '+919876543210' });
  mockFetch([{ method: 'POST', path: '/v1/auth/otp/verify', status: 401, body: { error: { code: 'UNAUTHORIZED', message: 'Incorrect OTP. 4 attempts left.' } } }]);
  const { useToast } = jest.requireActual('@/lib/toast');
  await render(withQuery(<OtpScreen />).ui);
  await fireEvent.changeText(screen.getByTestId('otp-input'), '000000');
  await waitFor(() => expect(useToast.getState().message).toBe('Incorrect OTP. 4 attempts left.'));
  await waitFor(() => expect(screen.getByTestId('otp-input').props.value).toBe(''));
});

test('address form pins GPS, pre-fills from reverse geocode and PUTs coordinates', async () => {
  const calls = mockFetch([{ method: 'PUT', path: '/v1/me/address', body: { ...ME, neighborhood: { name: 'HSR Layout' } } }]);
  const onDone = jest.fn();
  await render(withQuery(<AddressForm onDone={onDone} />).ui);
  expect(screen.getByTestId('save-address')).toBeDisabled();
  await fireEvent.press(screen.getByTestId('use-location'));
  expect(await screen.findByText('Home pin set')).toBeOnTheScreen();
  expect(screen.getByTestId('locality-input').props.value).toBe('HSR Layout Sector 2');
  expect(screen.getByTestId('pincode-input').props.value).toBe('560102');
  await fireEvent.changeText(screen.getByTestId('unit-input'), 'C-702');
  await fireEvent.press(screen.getByTestId('save-address'));
  await waitFor(() => expect(onDone).toHaveBeenCalled());
  expect(calls[0].body).toMatchObject({ unit: 'C-702', locality: 'HSR Layout Sector 2', city: 'Bengaluru', pincode: '560102', lat: 12.9126, lng: 77.6466 });
});

test('composer builds the right payload for a marketplace listing and an emergency alert', async () => {
  const calls = mockFetch([{ method: 'POST', path: '/v1/posts', status: 201, body: { id: 'p1' } }]);
  const { qc, ui } = withQuery(<CreatePost />);
  qc.setQueryData(['me'], ME);
  await useAuth.getState().signIn('acc', 'ref', ME as never);
  await render(ui);

  await fireEvent.press(screen.getByTestId('type-CLASSIFIED'));
  await fireEvent.changeText(screen.getByTestId('post-title'), 'Study table');
  await fireEvent.changeText(screen.getByTestId('post-price'), '4,500');
  await fireEvent.changeText(screen.getByTestId('post-body'), 'IKEA, like new');
  await fireEvent.press(screen.getByTestId('submit-post'));
  await waitFor(() => expect(calls).toHaveLength(1));
  expect(calls[0].body).toEqual({ type: 'CLASSIFIED', title: 'Study table', body: 'IKEA, like new', images: [], pricePaise: 450000, condition: 'GOOD' });

  await fireEvent.press(screen.getByTestId('type-ALERT'));
  await fireEvent.press(screen.getByTestId('sev-CRITICAL'));
  await fireEvent.changeText(screen.getByTestId('post-title'), 'Gas leak smell');
  await fireEvent.changeText(screen.getByTestId('post-body'), 'Near Tower B basement, avoid lighters');
  await fireEvent.press(screen.getByTestId('submit-post'));
  await waitFor(() => expect(calls).toHaveLength(2));
  expect(calls[1].body).toEqual({ type: 'ALERT', title: 'Gas leak smell', body: 'Near Tower B basement, avoid lighters', images: [], severity: 'CRITICAL' });
});

test('PHONE-level users see the verification gate instead of the composer', async () => {
  const { qc, ui } = withQuery(<CreatePost />);
  qc.setQueryData(['me'], { ...ME, verificationLevel: 'PHONE' });
  await useAuth.getState().signIn('acc', 'ref', { ...ME, verificationLevel: 'PHONE' } as never);
  mockFetch([{ method: 'GET', path: '/v1/me', body: { ...ME, verificationLevel: 'PHONE' } }]);
  await render(ui);
  expect(await screen.findByText('Verify your location to post')).toBeOnTheScreen();
  expect(screen.queryByTestId('submit-post')).not.toBeOnTheScreen();
});

test('verification screen sends the device fix and shows failure reasons', async () => {
  const calls = mockFetch([
    { method: 'GET', path: '/v1/me/verification', body: { level: 'PHONE', address: { status: 'PENDING', method: null }, gps: { passed: 0, required: 2, done: false, nextEligibleAt: null }, vouches: { count: 0, required: 2 } } },
    { method: 'POST', path: '/v1/me/verification/gps', body: { passed: false, reasons: ['You appear to be 950 m from your home pin. Run this check while at home.'], level: 'PHONE', progress: { passed: 0, required: 2 } } },
  ]);
  await useAuth.getState().signIn('acc', 'ref', ME as never);
  await render(withQuery(<Verify />).ui);
  await fireEvent.press(await screen.findByTestId('gps-check'));
  expect(await screen.findByText(/950 m from your home pin/)).toBeOnTheScreen();
  expect(calls.find((c) => c.url.endsWith('/verification/gps'))?.body).toEqual({ lat: 12.9126, lng: 77.6466, accuracyM: 12, isMocked: false });
});
