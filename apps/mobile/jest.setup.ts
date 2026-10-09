// Native-renderer test setup (jest-expo ios/android presets).
import '@testing-library/react-native';

// In-memory SecureStore so auth persistence can be exercised.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
    __store: store,
  };
});

jest.mock('expo-location', () => ({
  Accuracy: { High: 4 },
  requestForegroundPermissionsAsync: jest.fn(async () => ({ status: 'granted' })),
  getCurrentPositionAsync: jest.fn(async () => ({ coords: { latitude: 12.9126, longitude: 77.6466, accuracy: 12 }, mocked: false })),
  reverseGeocodeAsync: jest.fn(async () => [{ street: '27th Main Road', district: 'HSR Layout Sector 2', city: 'Bengaluru', postalCode: '560102' }]),
}));

jest.mock('expo-notifications', () => ({
  setNotificationHandler: jest.fn(),
  addNotificationResponseReceivedListener: jest.fn(() => ({ remove: jest.fn() })),
  getPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  requestPermissionsAsync: jest.fn(async () => ({ status: 'denied' })),
  setNotificationChannelAsync: jest.fn(),
  AndroidImportance: { DEFAULT: 3, MAX: 5 },
}));

// Navigation is asserted via these spies; screens are rendered directly.
jest.mock('expo-router', () => {
  const router = { push: jest.fn(), replace: jest.fn(), back: jest.fn(), canGoBack: jest.fn(() => true) };
  return {
    router,
    useRouter: () => router,
    useLocalSearchParams: jest.fn(() => ({})),
    useSegments: jest.fn(() => []),
    Redirect: () => null,
    Link: ({ children }: { children: unknown }) => children,
  };
});
