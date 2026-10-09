import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SecureStore from 'expo-secure-store';
import { confirm, ConfirmHost, openSheet, SheetHost, ToastHost } from '@/components/ui/Overlays';
import { onSignOut, useAuth } from '@/lib/auth';
import { toast } from '@/lib/toast';
import { AdCard } from '@/components/AdCard';

const metrics = { frame: { x: 0, y: 0, width: 390, height: 844 }, insets: { top: 47, left: 0, right: 0, bottom: 34 } };
const Hosts = () => (
  <SafeAreaProvider initialMetrics={metrics}>
    <SheetHost />
    <ConfirmHost />
    <ToastHost />
  </SafeAreaProvider>
);

test('action sheet → confirm dialog works in one go (no stacked native modals)', async () => {
  await render(<Hosts />);
  let answer: boolean | undefined;
  openSheet([{ label: 'Delete post', icon: 'trash', destructive: true, onPress: async () => { answer = await confirm('Delete this post?', undefined, { confirmText: 'Delete', destructive: true }); } }]);
  await fireEvent.press(await screen.findByTestId('sheet-Delete post'));
  expect(await screen.findByText('Delete this post?')).toBeOnTheScreen();
  await fireEvent.press(screen.getByTestId('confirm-ok'));
  await waitFor(() => expect(answer).toBe(true));
});

test('a newer confirm resolves an unanswered one as cancelled (callers never hang)', async () => {
  await render(<Hosts />);
  const first = confirm('First?');
  const second = confirm('Second?');
  await expect(first).resolves.toBe(false);
  await fireEvent.press(await screen.findByTestId('confirm-cancel'));
  await expect(second).resolves.toBe(false);
});

test('toasts render (as an alert) above everything', async () => {
  await render(<Hosts />);
  toast.error(new Error('Invalid plate'));
  expect(await screen.findByRole('alert')).toHaveTextContent(/Invalid plate/);
});

test('sign-out wipes storage and notifies listeners (query cache clear)', async () => {
  const cleared = jest.fn();
  const off = onSignOut(cleared);
  await useAuth.getState().signIn('a', 'r', { id: 'u' } as never);
  await useAuth.getState().signOut();
  expect(cleared).toHaveBeenCalledTimes(1);
  expect(await SecureStore.getItemAsync('mc.refresh')).toBeNull();
  off();
});

test('hydrate survives a Keystore failure and signs out instead of hanging', async () => {
  (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(new Error('KeyStore decrypt failed'));
  await useAuth.getState().hydrate();
  expect(useAuth.getState().status).toBe('signedOut');
});

test('ad cards do not bill an impression just by rendering', async () => {
  const fetchSpy = jest.fn(async () => new Response('{}'));
  globalThis.fetch = fetchSpy as unknown as typeof fetch;
  await render(
    <AdCard ad={{ id: 'ad1', headline: 'H', body: 'B', imageUrl: null, cta: 'CALL', sponsored: true, business: { id: 'b', name: 'Cafe', category: 'CAFE', phone: '+919900000003', whatsapp: null, isVerified: true, photos: [] } }} />,
  );
  expect(fetchSpy).not.toHaveBeenCalled();
});
