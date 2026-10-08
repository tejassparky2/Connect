import { Platform } from 'react-native';
import Constants from 'expo-constants';

/**
 * API base URL. Set EXPO_PUBLIC_API_URL for devices/production
 * (e.g. https://api.mohallaconnect.in or http://192.168.1.10:4000 for a phone on LAN).
 */
function defaultBase() {
  if (Platform.OS === 'android') return 'http://10.0.2.2:4000'; // Android emulator → host
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  if (host && Platform.OS !== 'web') return `http://${host}:4000`; // Expo Go on LAN
  return 'http://localhost:4000';
}

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || defaultBase()).replace(/\/$/, '');
