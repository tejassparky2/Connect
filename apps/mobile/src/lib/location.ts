import { Platform } from 'react-native';
import * as Location from 'expo-location';

export interface Fix {
  lat: number;
  lng: number;
  accuracyM: number;
  isMocked: boolean;
}

export class LocationError extends Error {}

/** High-accuracy fix for verification. Throws a user-friendly LocationError. */
export async function getFix(): Promise<Fix> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (perm.status !== 'granted') throw new LocationError('Location permission is needed to verify your neighbourhood. Enable it in Settings.');
  try {
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
    return {
      lat: pos.coords.latitude,
      lng: pos.coords.longitude,
      accuracyM: Math.round(pos.coords.accuracy ?? 999),
      isMocked: !!(pos as { mocked?: boolean }).mocked,
    };
  } catch {
    throw new LocationError("Couldn't get your location. Make sure GPS is on and try again.");
  }
}

export interface PlaceGuess {
  street?: string;
  locality?: string;
  city?: string;
  pincode?: string;
}

/** Best-effort reverse geocode to prefill the address form (not available on web). */
export async function guessPlace(lat: number, lng: number): Promise<PlaceGuess> {
  if (Platform.OS === 'web') return {};
  try {
    const [p] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    if (!p) return {};
    return { street: p.street ?? undefined, locality: p.district ?? p.subregion ?? undefined, city: p.city ?? undefined, pincode: p.postalCode ?? undefined };
  } catch {
    return {};
  }
}
