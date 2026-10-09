import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { secureStorage } from '@/lib/storage';

const PUSH_KEY = 'mc.push';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: true, shouldShowBanner: true, shouldShowList: true }),
});

/** Same routing as the in-app notification list, so a tap lands on the same screen. */
export function routeForNotification(d: Record<string, unknown>) {
  const s = (k: string) => (typeof d[k] === 'string' ? (d[k] as string) : undefined);
  if (s('postId')) return `/post/${s('postId')}`;
  if (s('conversationId')) return `/messages/${s('conversationId')}`;
  if (s('ticketId') && s('societyId')) return `/society/${s('societyId')}/tickets/${s('ticketId')}`;
  if (s('alertId') && s('societyId')) return `/society/${s('societyId')}/parking`;
  if (s('noticeId') && s('societyId')) return `/society/${s('societyId')}/notices`;
  if (s('societyId')) return `/society/${s('societyId')}`;
  if (s('businessId')) return `/business/${s('businessId')}`;
  if (s('campaignId')) return '/(tabs)/profile';
  return '/notifications';
}

/** Unregister this device's push token (call BEFORE revoking the session). */
export async function unregisterPush() {
  const token = await secureStorage.get(PUSH_KEY).catch(() => null);
  if (!token) return;
  await api.del('/me/push-tokens', { token }).catch(() => undefined);
  await secureStorage.remove(PUSH_KEY).catch(() => undefined);
}

/** Register this device for Expo push and deep-link on notification tap. No-op on web/simulators. */
export function usePushRegistration() {
  const status = useAuth((s) => s.status);
  useEffect(() => {
    if (status !== 'signedIn' || Platform.OS === 'web' || !Device.isDevice) return;
    (async () => {
      try {
        if (Platform.OS === 'android') {
          await Notifications.setNotificationChannelAsync('default', { name: 'General', importance: Notifications.AndroidImportance.DEFAULT });
          await Notifications.setNotificationChannelAsync('alerts', { name: 'Safety alerts', importance: Notifications.AndroidImportance.MAX, vibrationPattern: [0, 300, 200, 300] });
        }
        const { status: existing } = await Notifications.getPermissionsAsync();
        const finalStatus = existing === 'granted' ? existing : (await Notifications.requestPermissionsAsync()).status;
        if (finalStatus !== 'granted') return;
        const projectId = Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
        if (!projectId) return; // push tokens require an EAS projectId (set via `eas init`)
        const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
        await api.post('/me/push-tokens', { token, platform: Platform.OS });
        await secureStorage.set(PUSH_KEY, token);
      } catch {
        // Push is best-effort.
      }
    })();
  }, [status]);
}

/**
 * Routes notification taps — including the tap that cold-started the app — to the right screen.
 * Native only: getLastNotificationResponse doesn't exist on web, so this is a component that
 * the root layout mounts only when Platform.OS !== 'web' (not a conditionally-called hook).
 */
export function NotificationTapRouter() {
  const status = useAuth((s) => s.status);
  const lastResponse = Notifications.useLastNotificationResponse();
  const handled = useRef<string | null>(null);
  useEffect(() => {
    if (status !== 'signedIn' || !lastResponse) return;
    const id = `${lastResponse.notification.request.identifier}:${lastResponse.actionIdentifier}`;
    if (handled.current === id) return;
    handled.current = id;
    const d = lastResponse.notification.request.content.data as Record<string, unknown>;
    router.push(routeForNotification(d ?? {}));
  }, [status, lastResponse]);
  return null;
}
