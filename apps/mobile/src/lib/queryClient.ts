import { AppState, Platform } from 'react-native';
import * as Network from 'expo-network';
import { focusManager, onlineManager, QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => !(e instanceof ApiError && e.status >= 400 && e.status < 500) && n < 2,
      staleTime: 15_000,
    },
  },
});

/**
 * React Native has no window focus/online events: wire TanStack Query to AppState and
 * expo-network so data refreshes on app resume / reconnect and polling pauses in background.
 */
if (Platform.OS !== 'web') {
  focusManager.setEventListener((setFocused) => {
    const sub = AppState.addEventListener('change', (s) => setFocused(s === 'active'));
    return () => sub.remove();
  });
  onlineManager.setEventListener((setOnline) => {
    const sub = Network.addNetworkStateListener((st) => setOnline(st.isConnected !== false));
    return () => sub.remove();
  });
}
