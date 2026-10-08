import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import { router } from 'expo-router';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldPlaySound: true, shouldSetBadge: true, shouldShowBanner: true, shouldShowList: true }),
});

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
        const token = (await Notifications.getExpoPushTokenAsync(projectId ? { projectId } : undefined)).data;
        await api.post('/me/push-tokens', { token, platform: Platform.OS });
      } catch {
        // Push is best-effort (e.g. Expo Go without a projectId).
      }
    })();
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      const d = r.notification.request.content.data as Record<string, string>;
      if (d.postId) router.push(`/post/${d.postId}`);
      else if (d.conversationId) router.push(`/messages/${d.conversationId}`);
      else if (d.ticketId && d.societyId) router.push(`/society/${d.societyId}/tickets/${d.ticketId}`);
      else if (d.societyId) router.push(`/society/${d.societyId}`);
      else router.push('/notifications');
    });
    return () => sub.remove();
  }, [status]);
}
