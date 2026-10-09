import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { secureStorage } from './storage';

/**
 * API base URL. Set EXPO_PUBLIC_API_URL for devices/production
 * (e.g. https://api.mohallaconnect.in or http://192.168.1.10:4000 for a phone on LAN).
 */
function defaultBase() {
  // Dev only: derive the API host from the Metro dev-server host (works for physical devices on LAN).
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host && Platform.OS !== 'web' && host !== 'localhost' && host !== '127.0.0.1') return `http://${host}:4000`;
  if (Platform.OS === 'android') return 'http://10.0.2.2:4000'; // Android emulator → host machine
  return 'http://localhost:4000';
}

const BAKED_URL = process.env.EXPO_PUBLIC_API_URL;

if (!__DEV__ && !BAKED_URL) {
  // Release builds must point at an HTTPS API (cleartext HTTP is blocked on iOS/Android).
  console.warn('EXPO_PUBLIC_API_URL is not set for a release build');
}

/**
 * Test builds (no baked-in API URL, or EXPO_PUBLIC_ALLOW_SERVER_SWITCH=1) let the user point the app at
 * their own server from the welcome screen — e.g. a sideloaded APK talking to an API on a laptop.
 * Production builds bake EXPO_PUBLIC_API_URL and never show the switch.
 */
export const SERVER_SWITCH_ENABLED = !BAKED_URL || process.env.EXPO_PUBLIC_ALLOW_SERVER_SWITCH === '1';

const OVERRIDE_KEY = 'mc.apiUrl';
const DEFAULT_URL = (BAKED_URL || defaultBase()).replace(/\/$/, '');
let override: string | null = null;

/**
 * False only in a sideloaded test build where nobody has entered a server yet: its fallback
 * (10.0.2.2 = the emulator's host alias) can't work on a real phone, so the UI must ask first.
 */
export const hasUsableServer = () => !!override || !!BAKED_URL || __DEV__;

/** Current API base URL (no trailing slash). */
export const getApiUrl = () => override ?? DEFAULT_URL;

/** Normalise user input like "192.168.1.5:4000" → "http://192.168.1.5:4000". Returns null if unusable. */
export function normalizeServerUrl(input: string): string | null {
  let s = input.trim().replace(/\/+$/, '');
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  // scheme://host[:port] only — host is a name, IPv4 or [IPv6]; any path is dropped.
  const m = /^(https?):\/\/(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(?::(\d{1,5}))?(?:\/.*)?$/i.exec(s);
  if (!m || (m[3] && Number(m[3]) > 65535)) return null;
  return `${m[1].toLowerCase()}://${m[2].toLowerCase()}${m[3] ? `:${m[3]}` : ''}`;
}

/** Load a saved server override (called once at startup, before any request). */
export async function loadApiUrlOverride() {
  if (!SERVER_SWITCH_ENABLED) return;
  try {
    override = (await secureStorage.get(OVERRIDE_KEY)) || null;
  } catch {
    override = null;
  }
}

/** Save (or clear, with null) the server override. */
export async function setApiUrlOverride(url: string | null) {
  if (!SERVER_SWITCH_ENABLED) return;
  override = url;
  if (url) await secureStorage.set(OVERRIDE_KEY, url);
  else await secureStorage.remove(OVERRIDE_KEY);
}
