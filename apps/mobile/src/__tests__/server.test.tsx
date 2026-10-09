import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as SecureStore from 'expo-secure-store';
import { api } from '@/lib/api';
import { getApiUrl, loadApiUrlOverride, normalizeServerUrl, setApiUrlOverride } from '@/lib/config';
import { ServerSettings } from '@/components/ServerSettings';
import { mockFetch, withQuery } from './testUtils';

afterEach(async () => {
  await setApiUrlOverride(null);
});

test('normalizeServerUrl accepts bare IP:port and strips paths; rejects junk', () => {
  expect(normalizeServerUrl('192.168.1.20:4000')).toBe('http://192.168.1.20:4000');
  expect(normalizeServerUrl(' HTTPS://Api.Example.in/v1/ ')).toBe('https://api.example.in');
  expect(normalizeServerUrl('http://[fe80::1]:4000')).toBe('http://[fe80::1]:4000');
  expect(normalizeServerUrl('')).toBeNull();
  expect(normalizeServerUrl('not a url')).toBeNull();
  expect(normalizeServerUrl('10.0.0.1:99999')).toBeNull();
  expect(normalizeServerUrl('ftp://x')).toBeNull();
});

test('an unreachable server is rejected and nothing is saved', async () => {
  globalThis.fetch = jest.fn(async () => {
    throw new TypeError('Network request failed');
  }) as unknown as typeof fetch;
  const before = getApiUrl();
  const { ui } = withQuery(<ServerSettings />);
  await render(ui);
  await fireEvent.press(screen.getByTestId('server-settings'));
  await fireEvent.changeText(screen.getByTestId('server-url'), '10.9.9.9:4000');
  await fireEvent.press(screen.getByTestId('server-save'));
  await waitFor(() => expect(screen.getByText(/Couldn't reach that address/)).toBeTruthy());
  expect(getApiUrl()).toBe(before);
  expect(SecureStore.setItemAsync).not.toHaveBeenCalledWith('mc.apiUrl', expect.anything());
});

test('a healthy server is saved, persisted, and used for API calls (also after restart)', async () => {
  const calls = mockFetch([
    { method: 'GET', path: 'http://192.168.1.20:4000/health', body: { ok: true, db: 'up' } },
    { method: 'GET', path: /\/v1\/me\/badges$/, body: { notifications: 0, messages: 0 } },
  ]);
  const { ui } = withQuery(<ServerSettings />);
  await render(ui);
  await fireEvent.press(screen.getByTestId('server-settings'));
  await fireEvent.changeText(screen.getByTestId('server-url'), '192.168.1.20:4000');
  await fireEvent.press(screen.getByTestId('server-save'));
  await waitFor(() => expect(getApiUrl()).toBe('http://192.168.1.20:4000'));
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith('mc.apiUrl', 'http://192.168.1.20:4000');

  await api.get('/me/badges');
  expect(calls.at(-1)!.url).toBe('http://192.168.1.20:4000/v1/me/badges');

  // Simulated restart: the in-memory override is reloaded from secure storage.
  await loadApiUrlOverride();
  expect(getApiUrl()).toBe('http://192.168.1.20:4000');
});
